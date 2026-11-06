/**
 * Keyboard Maker — static site app.
 *
 * Everything runs client-side:
 *  - Keyman search via api.keyman.com (CORS-open) filtered by kvks_index.json
 *  - Keyman gridsets: KVKS fetched from raw.githubusercontent.com, remapped
 *    onto the bundled template.gridset in-browser (scripts/keyman-remap.mjs)
 *  - JSON layouts generated in-browser (@willwade/aac-processors bundle)
 *  - Live previews via aac-board-viewer bundle
 */

const KEYMAN_API = 'https://api.keyman.com/search/2.0';
const PREVIEW_CACHE_KEYMAN_LIMIT = 8; // keep at most N keyman gridsets cached

const state = {
  kvksIndex: null,
  templateBytes: null,
  libraryLayouts: [],        // bundled layouts (from docs/layouts/)
  localLayouts: [],          // saved in localStorage
  results: [],               // unified search results
  selection: null,           // { source, ... }
  layoutBytesCache: new Map(),   // id -> { bytes, filename }
  keymanCache: new Map(),        // id -> { bytes, filename } | { error }
  hoverTimer: null,
  hoveredId: null,
};

// ---------------------------------------------------------------- utilities

const $ = (sel) => document.querySelector(sel);

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function loadLocalLayouts() {
  try {
    state.localLayouts = JSON.parse(localStorage.getItem('keyboardmaker.layouts') || '[]');
  } catch { state.localLayouts = []; }
}

function saveLocalLayouts() {
  localStorage.setItem('keyboardmaker.layouts', JSON.stringify(state.localLayouts));
}

// localStorage-backed cache for keyman gridsets (survives reloads)
function keymanCacheLoad() {
  try {
    const entries = JSON.parse(localStorage.getItem('keyboardmaker.keymanCache') || '{}');
    for (const [id, b64] of Object.entries(entries)) state.keymanCache.set(id, b64);
  } catch { /* ignore */ }
}
function keymanCachePersist(id, b64) {
  state.keymanCache.set(id, b64);
  try {
    const entries = {};
    const ids = [...state.keymanCache.keys()].slice(-PREVIEW_CACHE_KEYMAN_LIMIT);
    for (const key of ids) entries[key] = state.keymanCache.get(key);
    localStorage.setItem('keyboardmaker.keymanCache', JSON.stringify(entries));
  } catch { /* quota — ignore */ }
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------- data loading

async function init() {
  loadLocalLayouts();
  keymanCacheLoad();

  const [kvksIndex, template, manifest] = await Promise.all([
    fetch('kvks_index.json').then((r) => r.json()),
    fetch('template.gridset').then((r) => r.arrayBuffer()),
    fetch('layouts/index.json').then((r) => r.json()).catch(() => []),
  ]);

  state.kvksIndex = kvksIndex;
  state.templateBytes = new Uint8Array(template);

  for (const file of manifest) {
    try {
      const data = await fetch(`layouts/${file}`).then((r) => r.json());
      state.libraryLayouts.push({ file, data });
    } catch (e) {
      console.warn(`Could not load layout ${file}`, e);
    }
  }

  $('#search-button').addEventListener('click', runSearch);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('#modal-backdrop')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  setupOwnLayout();

  // Prefill with Gujarati so first-time visitors see something to explore
  $('#search-input').value = 'gujarati';
  runSearch();
}

// ------------------------------------------------------------------- search

function layoutMatches(query, data, file) {
  if (!query) return true;
  const haystack = [
    data.layout || '',
    data.locale || '',
    file || '',
    (data.languages || []).join(' '),
    data.description || '',
  ].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((t) => haystack.includes(t));
}

async function runSearch() {
  const query = $('#search-input').value.trim();
  const status = $('#search-status');
  status.textContent = 'Searching…';

  let keymanKeyboards = [];
  if (query) {
    try {
      const r = await fetch(`${KEYMAN_API}?q=l:${encodeURIComponent(query)}&f=1`);
      const data = await r.json();
      keymanKeyboards = (data.keyboards || []).filter((k) => state.kvksIndex && k.id in state.kvksIndex);
    } catch (e) {
      console.warn('Keyman search failed', e);
    }
  }

  const q = query;
  const layouts = [
    ...state.libraryLayouts.filter((l) => layoutMatches(q, l.data, l.file)),
    ...state.localLayouts.filter((l) => layoutMatches(q, l.data, l.file)),
  ];

  state.results = [
    ...layouts.map((l) => ({ source: 'layout', ...l })),
    ...keymanKeyboards.map((k) => ({ source: 'keyman', keyboard: k })),
  ];

  renderResults();
  status.textContent = state.results.length
    ? `${state.results.length} keyboard(s) found — hover to preview, click to select.`
    : 'No keyboards found. Try another language name, or add your own JSON layout below.';
  if (!state.results.length) $('#results').classList.add('hidden');
}

function itemFor(entry) {
  if (entry.source === 'layout') {
    const data = entry.data;
    const langs = (data.languages && data.languages.length ? data.languages : [data.locale || '']).join(', ');
    return {
      id: `layout::${entry.file}::${data.layout || ''}`,
      label: data.layout || entry.file,
      sub: [langs, data.locale].filter(Boolean).join(' · '),
      source: 'layout',
      entry,
    };
  }
  const k = entry.keyboard;
  const langsRaw = k.languages || {};
  const langs = (Array.isArray(langsRaw) ? langsRaw : Object.keys(langsRaw)).slice(0, 3).join(', ');
  return {
    id: `keyman::${k.id}`,
    label: k.name,
    sub: [k.id, langs].filter(Boolean).join(' · '),
    source: 'keyman',
    entry,
  };
}

function renderResults() {
  const list = $('#results-list');
  const pane = $('#hover-preview');
  pane.innerHTML = '<div class="placeholder">Hover an entry to preview it here.<br />Click to select it.</div>';
  list.innerHTML = '';
  $('#results').classList.remove('hidden');

  for (const entry of state.results) {
    const item = itemFor(entry);
    const div = document.createElement('div');
    div.className = 'item' + (idOf(state.selection) === item.id ? ' selected' : '');
    div.dataset.id = item.id;
    div.innerHTML = `
      <div class="label"></div>
      <div class="sub"><span class="tag ${item.source}">${item.source === 'layout' ? 'json layout' : 'keyman'}</span><span></span></div>`;
    div.querySelector('.label').textContent = item.label;
    div.querySelector('.sub span:last-child').textContent = item.sub;

    div.addEventListener('mouseenter', () => scheduleHover(item.id));
    div.addEventListener('click', () => selectItem(item.id));
    list.appendChild(div);
  }
}

function idOf(entry) {
  return entry ? itemFor(entry).id : null;
}

// ------------------------------------------------------------- hover previews

function scheduleHover(id) {
  if (state.hoveredId === id) return;
  state.hoveredId = id;
  clearTimeout(state.hoverTimer);
  state.hoverTimer = setTimeout(() => renderHoverPreview(id), 250);
}

function findEntryById(id) {
  for (const entry of state.results) {
    if (itemFor(entry).id === id) return entry;
  }
  return null;
}

async function ensureLayoutBytes(item) {
  const cached = state.layoutBytesCache.get(item.id);
  if (cached) return cached;
  const data = item.entry.data;
  const result = await window.LayoutGeneratorBundle.generateGridset(data, {
    includeWorkspace: data.workspace !== false,
  });
  const value = { bytes: result.bytes, filename: result.filename, summary: result.summary };
  state.layoutBytesCache.set(item.id, value);
  return value;
}

async function ensureKeymanBytes(item) {
  const kid = item.entry.keyboard.id;
  const b64 = state.keymanCache.get(kid);
  if (b64) return { bytes: b64ToBytes(b64), filename: `${kid}.gridset` };

  const githubLink = state.kvksIndex[kid];
  const rawUrl = githubLink
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/');
  const kvksText = await (await fetch(rawUrl)).text();
  if (!kvksText || kvksText.startsWith('404')) throw new Error(`Could not fetch the KVKS file for ${kid}`);
  const bytes = await window.KeymanRemap.buildKeymanGridset(state.templateBytes, kvksText, {});
  keymanCachePersist(kid, bytesToB64(bytes));
  return { bytes, filename: `${kid}.gridset` };
}

async function renderHoverPreview(id) {
  const entry = findEntryById(id);
  if (!entry) return;
  const item = itemFor(entry);
  const pane = $('#hover-preview');
  if (state.hoveredId !== id) return;

  const provider = item.source === 'layout' ? ensureLayoutBytes(item) : ensureKeymanBytes(item);
  pane.innerHTML = '<div class="loading"><span class="spin"></span>' +
    (item.source === 'layout' ? 'Generating preview…' : 'Fetching Keyman keyboard & remapping template…') +
    '</div>';

  try {
    const { bytes, filename } = await provider;
    if (state.hoveredId !== id) return;
    pane.innerHTML = '';
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = item.label;
    pane.appendChild(badge);
    const holder = document.createElement('div');
    pane.appendChild(holder);
    await window.BoardPreviewBundle.previewGridset(holder, bytes, filename);
  } catch (e) {
    if (state.hoveredId !== id) return;
    pane.innerHTML = `<div class="placeholder">Preview failed: ${e && e.message ? e.message : e}</div>`;
  }
}

// ------------------------------------------------------------------ details

function selectItem(id) {
  const entry = findEntryById(id);
  if (!entry) return;
  state.selection = entry;
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  renderDetails();
  $('#details').classList.remove('hidden');
  $('#details').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetails() {
  const entry = state.selection;
  const details = $('#details');
  if (!entry) { details.classList.add('hidden'); return; }

  if (entry.source === 'layout') {
    const data = entry.data;
    details.innerHTML = `
      <h2></h2>
      <p class="hint">Generate a Grid 3 gridset from this JSON layout — entirely in your browser.</p>
      <div class="row">
        <button id="d-preview-modal">Preview in a modal</button>
      </div>
      <div class="row">
        <label class="inline"><input type="checkbox" id="d-workspace" ${data.workspace !== false ? 'checked' : ''}/> Add a chat workspace (message bar) row</label>
      </div>
      <div class="row">
        <button id="d-generate">Generate gridset</button>
        <span id="d-status" class="status"></span>
      </div>
      <div class="row" id="d-download-row" hidden>
        <a id="d-download" class="download-link" download></a>
      </div>
      <div id="d-verify" class="status"></div>
      <ul class="warnings" id="d-warnings" hidden></ul>
      <div class="inline-preview" id="d-inline-preview"><div class="placeholder" style="padding:0.9rem;color:#8a8f98">Preview appears here after generating…</div></div>`;
    details.querySelector('h2').textContent = `Layout: ${data.layout || entry.file}`;

    $('#d-preview-modal').addEventListener('click', () => openModal());
    $('#d-generate').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const status = $('#d-status');
      status.textContent = 'Generating…';
      try {
        const includeWorkspace = $('#d-workspace').checked;
        const result = await window.LayoutGeneratorBundle.generateGridset(data, { includeWorkspace });
        const dl = $('#d-download');
        dl.href = URL.createObjectURL(new Blob([result.bytes], { type: 'application/zip' }));
        dl.download = result.filename;
        dl.textContent = `Download ${result.filename}`;
        $('#d-download-row').hidden = false;
        status.textContent = `Ready — ${result.summary.pages} page(s), ${result.summary.buttons} keys.`;

        const v = result.summary.validation;
        $('#d-verify').textContent = v
          ? (v.valid ? `Verified: ${v.checks.length} checks passed` : `Verification FAILED: ${v.errors} error(s)`)
          : '';
        $('#d-verify').className = 'status ' + (v && v.valid ? 'verify-ok' : 'verify-bad');

        const ul = $('#d-warnings');
        ul.innerHTML = '';
        (result.summary.warnings || []).forEach((w) => {
          const li = document.createElement('li');
          li.textContent = w;
          ul.appendChild(li);
        });
        ul.hidden = !(result.summary.warnings || []).length;

        const holder = $('#d-inline-preview');
        holder.innerHTML = '';
        try {
          await window.BoardPreviewBundle.previewGridset(holder, result.bytes, result.filename);
        } catch (perr) {
          holder.innerHTML = `<div class="placeholder" style="padding:0.9rem">Preview unavailable: ${perr.message || perr}</div>`;
        }
      } catch (err) {
        status.textContent = `Error: ${err.message || err}`;
      } finally {
        btn.disabled = false;
      }
    });
  } else {
    const k = entry.keyboard;
    const guess = window.KeymanRemap.guessGridLanguage(k) || '';
    const languages = ['', ...Object.keys(window.KeymanRemap.GRID_SUPPORTED_LANGUAGES)];
    const names = window.KeymanRemap.GRID_SUPPORTED_LANGUAGES;
    details.innerHTML = `
      <h2></h2>
      <p class="hint">Remap the Grid 3 template with this Keyman keyboard — fetched and built in your browser.</p>
      <div class="row">
        <button id="k-preview-modal">Preview keyboard</button>
      </div>
      <div class="row">
        <label for="k-language">Language setting (optional — match your Windows language pack):</label>
      </div>
      <div class="row">
        <select id="k-language"></select>
      </div>
      <div class="row">
        <button id="k-build">Build & download gridset</button>
        <span id="k-status" class="status"></span>
      </div>`;
    details.querySelector('h2').textContent = `Keyman keyboard: ${k.name} (${k.id})`;

    const select = $('#k-language');
    for (const code of languages) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code ? `${code} (${names[code][1]})` : 'No language setting';
      if (code === guess) opt.selected = true;
      select.appendChild(opt);
    }

    $('#k-preview-modal').addEventListener('click', () => openModal());
    $('#k-build').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const status = $('#k-status');
      status.textContent = 'Building…';
      try {
        const item = itemFor(entry);
        const githubLink = state.kvksIndex[k.id];
        const rawUrl = githubLink
          .replace('https://github.com/', 'https://raw.githubusercontent.com/')
          .replace('/blob/', '/');
        const kvksText = await (await fetch(rawUrl)).text();
        const language = select.value || undefined;
        const bytes = await window.KeymanRemap.buildKeymanGridset(state.templateBytes, kvksText, { language });
        if (!language) keymanCachePersist(k.id, bytesToB64(bytes));
        downloadBytes(bytes, `${k.id}.gridset`);
        status.textContent = `Downloaded ${k.id}.gridset (${(bytes.length / 1024).toFixed(1)} KB).`;
      } catch (err) {
        status.textContent = `Error: ${err.message || err}`;
      } finally {
        btn.disabled = false;
      }
    });
  }
}

// -------------------------------------------------------------------- modal

async function openModal() {
  const entry = state.selection;
  if (!entry) return;
  $('#modal-backdrop').classList.remove('hidden');
  const body = $('#modal-body');
  $('#modal-title').textContent = entry.source === 'layout'
    ? `Preview: ${entry.data.layout || entry.file}`
    : `Preview: ${entry.keyboard.name}`;
  body.innerHTML = '<div class="loading"><span class="spin"></span>Loading preview…</div>';

  try {
    let bytes, filename;
    if (entry.source === 'layout') {
      ({ bytes, filename } = await ensureLayoutBytes(itemFor(entry)));
    } else {
      ({ bytes, filename } = await ensureKeymanBytes(itemFor(entry)));
    }
    body.innerHTML = '';
    await window.BoardPreviewBundle.previewGridset(body, bytes, filename);
  } catch (e) {
    body.innerHTML = `<div class="placeholder" style="padding:1rem;color:#d93025">Preview failed: ${e.message || e}</div>`;
  }
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#modal-body').innerHTML = '';
}

// --------------------------------------------------------------- own layout

function setupOwnLayout() {
  let ownLayout = null;

  $('#layout-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      ownLayout = JSON.parse(await file.text());
      $('#own-layout-actions').classList.remove('hidden');
      $('#own-layout-name').textContent = ownLayout.layout || file.name;
      $('#own-layout-feedback').textContent = '';
    } catch (err) {
      $('#own-layout-actions').classList.add('hidden');
      $('#own-layout-feedback').textContent = `Could not parse JSON: ${err.message}`;
    }
  });

  $('#own-layout-use').addEventListener('click', () => {
    if (!ownLayout) return;
    const entry = { source: 'layout', file: `own-${Date.now()}.json`, data: ownLayout };
    state.selection = entry;
    // make it previewable from the details view even though it is not in results
    state.results = [{ source: 'layout', ...entry }, ...state.results.filter((r) => r !== entry)];
    renderResults();
    selectItem(itemFor(entry).id);
  });

  $('#own-layout-save').addEventListener('click', () => {
    if (!ownLayout) return;
    const file = `own-${(ownLayout.layout || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    state.localLayouts.push({ file, data: ownLayout });
    saveLocalLayouts();
    $('#own-layout-feedback').textContent = `Saved as “${file}” — it now appears in searches on this device.`;
    runSearch();
  });
}

init();
