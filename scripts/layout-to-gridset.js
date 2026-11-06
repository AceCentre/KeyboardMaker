/**
 * layout-to-gridset.js
 *
 * Shared (pure ESM, no Node APIs): convert a row/key keyboard layout JSON
 * into an aac-processors AACTree plus warnings.
 *
 * Used by:
 *   - scripts/generate-gridset.mjs        (Node CLI, writes .gridset to disk)
 *   - scripts/browser-entry.mjs           (browser bundle, returns bytes)
 *
 * Layout format: see layouts/README.md
 */

import {
  AACTree,
  AACPage,
  AACButton,
} from '@willwade/aac-processors';

const PUNCTUATION = new Set([
  '.', ',', '?', '!', ';', ':', "'", '"', '-', '(', ')', '/',
  '@', '#', '$', '%', '&', '*', '+', '=', '<', '>', '[', ']',
  '{', '}', '\\', '|', '_', '~', '`', '^',
]);

export const KEY_STYLES = {
  character: { backgroundColor: '#EAF2FBFF', borderColor: '#FFFFFFFF', fontColor: '#1B1F23FF', fontSize: 22 },
  action: { backgroundColor: '#2D3134FF', borderColor: '#FFFFFFFF', fontColor: '#FFFFFFFF', fontSize: 16 },
};

export function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Keyboard';
}

function normalizeKeyText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

function grid3Command(commandId, parameters = {}) {
  return {
    intent: 'CUSTOM_GRID3_COMMAND',
    platformData: { grid3: { commandId, parameters } },
  };
}

function commandForCharacter(key) {
  const value = String(key.value ?? '');
  const codePoints = Array.from(value);
  if (codePoints.length === 0) {
    return { warning: `Key "${key.label}" has an empty value; kept as a caption only.` };
  }
  if (codePoints.length === 1 && PUNCTUATION.has(value)) {
    return { semanticAction: grid3Command('Action.Punctuation', { letter: value }) };
  }
  if (codePoints.length === 1) {
    return { semanticAction: grid3Command('Action.Letter', { letter: value }) };
  }
  // Multi-codepoint values (conjuncts like ક્ષ, clusters like ઓૅ, "S̱")
  return { semanticAction: grid3Command('Action.InsertText', { text: value }) };
}

/**
 * Decide the Grid 3 command for a key.
 * Returns { semanticAction } and/or { warning }; empty result means caption-only.
 */
export function commandForKey(key, pageNames) {
  if (key.type !== 'action') return commandForCharacter(key);

  const label = normalizeKeyText(key.label);
  const value = String(key.value ?? '');

  // Delete / backspace
  if (value === '⌫' || label.includes('delete') || label.includes('backspace')) {
    return { semanticAction: grid3Command('Action.DeleteLetter') };
  }
  // Return / enter
  if (value === '↵' || value === '\n' || label.includes('return') || label.includes('enter')) {
    return { semanticAction: grid3Command('Action.Enter') };
  }
  // Space
  if (value === ' ' || label.includes('space')) {
    return { semanticAction: grid3Command('Action.Space') };
  }
  // Tab / arrow
  if (value === '⇥' || value === '⇄' || label.includes('tab')) {
    return {
      semanticAction: grid3Command('ComputerControl.Keyboard', { keystring: '{TAB}' }),
      warning: `"${key.label}" mapped to ComputerControl.Keyboard {TAB} (desktop Grid 3 only)`,
    };
  }
  // Symbols layer
  if (label.includes('symbol') || /^!?1?\?#\+?=*$/.test(value) || /^#+=/.test(value)) {
    const target = pageNames.find((n) => /symbol/i.test(n));
    if (target) {
      return { semanticAction: grid3Command('Jump.To', { grid: target }) };
    }
    return {
      warning: `"${key.label}" kept as a caption only: no symbols page named "*symbols*" in this layout. Add a page with "name": "Symbols" to link it.`,
    };
  }
  // Globe / keyboard switcher
  if (value === '🌐' || label.includes('globe') || (label.includes('keyboard') && label.includes('switch'))) {
    return { semanticAction: grid3Command('Settings.GridExplorer') };
  }
  // Hide keyboard
  if (value === '⌨' || value === '⌨️' || label.includes('hide')) {
    return {
      warning: `"${key.label}" kept as a caption only: Grid 3 has no "hide keyboard" command.`,
    };
  }
  // Dictation
  if (value === '🎤' || label.includes('dictat') || label.includes('microphone')) {
    return {
      warning: `"${key.label}" kept as a caption only: Grid 3 has no dictation command.`,
    };
  }
  // Unknown action: fall back to inserting the raw value if it is printable text
  if (value && value.trim().length > 0) {
    return commandForCharacter({ ...key, type: 'character' });
  }
  return { warning: `Action "${key.label}" has no value; kept as a caption only.` };
}

/**
 * Build a single AACPage from a page definition ({ name?, rows? }).
 */
export function buildPage(pageDef, layout, allPageNames, { includeWorkspace = true } = {}) {
  const pageName = sanitizeName(pageDef.name || pageDef.layout || layout.layout || 'Keyboard');
  const rows = pageDef.rows || [];
  const warnings = [];

  if (rows.length === 0) {
    throw new Error(`Page "${pageName}" has no rows.`);
  }

  const numColumns = Math.max(...rows.map((r) => Math.max(0, ...(r.keys || []).map((k) => k.position || 0))));
  const numKeyboardRows = Math.max(...rows.map((r) => r.row_index || 0));
  if (numColumns === 0) throw new Error(`Page "${pageName}" has no keys with positions.`);

  const buttons = [];
  const grid = [];

  if (includeWorkspace) {
    const workspace = new AACButton({
      id: 'workspace-chat',
      label: 'workspace',
      message: '',
      contentType: 'Workspace',
      contentSubType: 'Chat',
      // Explicit font colour: without this the gridset writer derives an
      // inline FontColour from an empty style and ends up forcing white text
      // onto the workspace (aac-processors 0.4.1 bug), making the chat bar
      // look empty in Grid 3.
      style: { fontColor: '#000000FF' },
    });
    buttons.push(workspace);
    grid.push(Array.from({ length: numColumns }, () => workspace));
  }

  const rowByKeyIndex = new Map(rows.map((r) => [r.row_index, r]));
  for (let rowIndex = 1; rowIndex <= numKeyboardRows; rowIndex++) {
    const row = rowByKeyIndex.get(rowIndex);
    const gridRow = Array.from({ length: numColumns }, () => null);
    if (row && Array.isArray(row.keys)) {
      for (const key of row.keys) {
        const x = (key.position || 1) - 1;
        if (x < 0 || x >= numColumns) {
          warnings.push(`Key "${key.label}" at position ${key.position} in row ${rowIndex} is outside the grid (1-${numColumns}); skipped.`);
          continue;
        }
        if (gridRow[x]) {
          warnings.push(`Duplicate key at row ${rowIndex} position ${key.position}; "${key.label}" overwrites "${gridRow[x].label}".`);
        }
        const result = commandForKey(key, allPageNames);
        if (result.warning) warnings.push(result.warning);
        const button = new AACButton({
          id: `r${rowIndex}-k${key.position}`,
          label: String(key.label ?? key.value ?? ''),
          message: String(key.value ?? ''),
          contentType: 'Normal',
          style: { ...KEY_STYLES[key.type] },
          ...(result.semanticAction ? { semanticAction: result.semanticAction } : {}),
        });
        buttons.push(button);
        gridRow[x] = button;
      }
    } else if (row === undefined) {
      warnings.push(`Row ${rowIndex} is missing from the layout (row_index values should be contiguous from 1).`);
    }
    grid.push(gridRow);
  }

  const page = new AACPage({
    id: `page-${pageName.toLowerCase().replace(/\s+/g, '-')}`,
    name: pageName,
    grid,
    buttons,
    parentId: null,
  });

  return { page, warnings };
}

/**
 * Build a complete AACTree from a layout JSON object.
 */
export function buildTree(layout, { includeWorkspace = true, fallbackName = 'Keyboard' } = {}) {
  const warnings = [];
  const pageDefs = Array.isArray(layout.pages) && layout.pages.length > 0
    ? layout.pages
    : [{ name: layout.layout, rows: layout.rows }];
  const allPageNames = pageDefs.map((p) => sanitizeName(p.name || p.layout || layout.layout || fallbackName));

  const tree = new AACTree();
  tree.metadata = {
    format: 'gridset',
    name: layout.layout || fallbackName,
    description: layout.description || '',
    locale: layout.locale || 'en-US',
  };

  let rootId = null;
  pageDefs.forEach((pageDef, i) => {
    const { page, warnings: pageWarnings } = buildPage(pageDef, layout, allPageNames, { includeWorkspace });
    warnings.push(...pageWarnings);
    tree.addPage(page);
    if (i === 0) rootId = page.id;
    if (layout.root && sanitizeName(pageDef.name) === sanitizeName(layout.root)) {
      rootId = page.id;
    }
  });
  tree.rootId = rootId;

  return { tree, warnings };
}

export function summarize(tree, warnings, extra = {}) {
  let buttons = 0;
  for (const page of Object.values(tree.pages)) buttons += page.buttons.length;
  return {
    ok: true,
    layout: tree.metadata.name,
    locale: tree.metadata.locale,
    pages: Object.keys(tree.pages).length,
    buttons,
    warnings,
    ...extra,
  };
}
