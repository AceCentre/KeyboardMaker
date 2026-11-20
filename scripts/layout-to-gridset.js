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

/**
 * Modifier layers: a key may define per-state variants and the layout gains
 * one generated page per state. State names are modifier names joined by
 * "_", in canonical order: shift, ctrl, alt, opt (e.g. "shift", "shift_opt").
 */
const MODIFIER_ORDER = ['shift', 'ctrl', 'alt', 'opt'];

export function canonicalStateName(name) {
  const parts = String(name)
    .toLowerCase()
    .split(/[_+\s]+/)
    .map((p) => p.trim())
    .filter((p) => MODIFIER_ORDER.includes(p));
  const ordered = MODIFIER_ORDER.filter((m) => parts.includes(m));
  return ordered.join('_');
}

/** Normalised modifier name for a key, or null when the key is not a
 *  modifier toggle (⇧ shift, ⌃ ctrl, ⌥ alt/option). */
export function detectModifier(label, value) {
  const l = String(label ?? '');
  const v = String(value ?? '');
  if (v === '⇧' || /\bshift\b/i.test(l)) return 'shift';
  if (v === '⌃' || /\bctrl\b/i.test(l) || /\bcontrol\b/i.test(l)) return 'ctrl';
  if (v === '⌥' && /\balt\b/i.test(l)) return 'alt';
  if (v === '⌥' || /\balt\b/i.test(l) || /\bopt(ion)?\b/i.test(l)) return 'opt';
  return null;
}

/**
 * XOR-toggle target state for a modifier on the current state:
 * default + shift -> "shift"; shift + shift -> ""; opt + shift -> "shift_opt";
 * shift_opt + shift -> "opt". Returns "" for the default (unmodified) layer.
 */
export function toggleState(current, modifier) {
  const existing = current ? current.split('_') : [];
  if (existing.includes(modifier)) {
    return existing.filter((p) => p !== modifier).join('_');
  }
  return canonicalStateName([...existing, modifier].join('_'));
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
 * `layerCtx` (optional) enables modifier toggles: { states: Set<string>,
 * current: string|null, defaultPage: string }. When present, shift/ctrl/
 * alt/opt action keys become Jump.To toggles between the generated layers.
 * Returns { semanticAction } and/or { warning }; empty result means caption-only.
 */
export function commandForKey(key, pageNames, layerCtx = null) {
  if (key.type !== 'action') return commandForCharacter(key);

  const label = normalizeKeyText(key.label);
  const rawLabel = String(key.label ?? '');
  const value = String(key.value ?? '');

  // Modifier toggles (shift/ctrl/alt/opt) between state layers
  if (layerCtx) {
    const modifier = detectModifier(rawLabel, value);
    if (modifier) {
      if (!layerCtx.states.has(modifier)) {
        return {
          warning: `"${key.label}" kept as a caption only: no key defines a "${modifier}" state, so there is no ${modifier} layer to jump to.`,
        };
      }
      const target = toggleState(layerCtx.current, modifier);
      const targetPage = target === '' ? layerCtx.defaultPage : target;
      if (target !== '' && !layerCtx.states.has(target)) {
        return {
          warning: `"${key.label}" on layer "${layerCtx.current || 'default'}" kept as a caption only: no key defines a "${target}" state layer to jump to.`,
        };
      }
      return { semanticAction: grid3Command('Jump.To', { grid: targetPage }) };
    }
  }

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
 * Resolve the key definition for a state layer: a key with a matching
 * state variant uses the variant's label/value, otherwise it inherits its
 * base definition.
 */
function resolveKeyForLayer(key, stateName) {
  if (!stateName || !key.states) return key;
  const variant = key.states[stateName];
  if (!variant) return key;
  return {
    ...key,
    label: variant.label ?? key.label,
    value: variant.value ?? key.value,
    states: undefined,
  };
}

/**
 * Build a single AACPage from a page definition ({ name?, rows?, layerState? }).
 */
export function buildPage(pageDef, layout, allPageNames, { includeWorkspace = true, layerCtx = null } = {}) {
  const pageName = sanitizeName(pageDef.name || pageDef.layout || layout.layout || 'Keyboard');
  const rows = pageDef.rows || [];
  const warnings = [];
  const stateName = pageDef.layerState || null;

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
      // No explicit style: since @willwade/aac-processors 0.4.2 the writer
      // leaves plugin cells' text colour to the referenced Workspace style
      // (AACProcessors-nodejs#57), which is exactly what Grid 3's own editor
      // emits.
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
        const resolved = resolveKeyForLayer(key, stateName);
        const result = commandForKey(resolved, allPageNames, layerCtx);
        if (result.warning) warnings.push(result.warning);
        const button = new AACButton({
          id: `r${rowIndex}-k${key.position}`,
          label: String(resolved.label ?? resolved.value ?? ''),
          message: String(resolved.value ?? ''),
          contentType: 'Normal',
          style: { ...KEY_STYLES[resolved.type] },
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
 * Collect the canonical state names used by any key's `states` map.
 */
function collectStateNames(pageDefs) {
  const names = new Set();
  for (const pageDef of pageDefs) {
    for (const row of pageDef.rows || []) {
      for (const key of row.keys || []) {
        for (const stateName of Object.keys(key.states || {})) {
          const canonical = canonicalStateName(stateName);
          if (canonical) names.add(canonical);
        }
      }
    }
  }
  return names;
}

/**
 * Build a complete AACTree from a layout JSON object.
 *
 * When any key defines `states`, the layout is expanded into one page per
 * state layer (identical geometry, per-key variants resolved) and
 * shift/ctrl/alt/opt action keys become Jump.To toggles between the layers.
 */
export function buildTree(layout, { includeWorkspace = true, fallbackName = 'Keyboard' } = {}) {
  const warnings = [];
  let pageDefs = Array.isArray(layout.pages) && layout.pages.length > 0
    ? layout.pages
    : [{ name: layout.layout, rows: layout.rows }];

  let layerCtx = null;
  const stateNames = collectStateNames(pageDefs);
  if (stateNames.size > 0) {
    if (Array.isArray(layout.pages) && layout.pages.length > 0) {
      throw new Error('Explicit "pages" and per-key "states" cannot be combined: states expand into generated layer pages.');
    }
    const defaultPageName = sanitizeName(layout.layout || fallbackName);
    for (const stateName of stateNames) {
      if (stateName === defaultPageName.toLowerCase()) {
        throw new Error(`State layer "${stateName}" collides with the layout name "${defaultPageName}".`);
      }
    }
    pageDefs = [
      { name: defaultPageName, rows: layout.rows },
      ...[...stateNames].map((stateName) => ({ name: stateName, layerState: stateName, rows: layout.rows })),
    ];
    layerCtx = { states: stateNames, current: null, defaultPage: defaultPageName };
  }

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
    const pageLayerCtx = layerCtx
      ? { ...layerCtx, current: pageDef.layerState || null }
      : null;
    const { page, warnings: pageWarnings } = buildPage(pageDef, layout, allPageNames, { includeWorkspace, layerCtx: pageLayerCtx });
    warnings.push(...pageWarnings);
    tree.addPage(page);
    if (i === 0) rootId = page.id;
    if (layout.root && sanitizeName(pageDef.name) === sanitizeName(layout.root)) {
      rootId = page.id;
    }
  });
  tree.rootId = rootId;

  if (stateNames.size > 0) {
    warnings.push(`Expanded key states into ${stateNames.size + 1} pages: default + ${[...stateNames].join(', ')}.`);
  }

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
