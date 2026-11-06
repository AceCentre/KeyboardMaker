/**
 * preview-entry.mjs
 *
 * In-browser gridset preview built on aac-board-viewer.
 * Bundled by esbuild into static/board-preview.js as window.BoardPreviewBundle.
 *
 * Exposes:
 *   previewGridset(container, bytes, filename) -> Promise<{ pages, buttons }>
 *     Loads the generated .gridset bytes with aac-board-viewer's loader
 *     (re-parsing the real artifact, not the pre-write tree) and mounts the
 *     React BoardViewer into `container`. Containers can be re-previewed
 *     repeatedly (the React root is reused), so this is safe for hover lists.
 *
 *   inspectGridset(bytes, filename) -> Promise<{ pages, buttons }>
 *     Parse only, no rendering (Node smoke tests).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BoardViewer, loadAACFile } from 'aac-board-viewer';

const roots = new WeakMap();

function toBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function previewGridset(container, bytes, filename = 'keyboard.gridset') {
  const tree = await loadAACFile(toBuffer(bytes), filename);

  const pageCount = Object.keys(tree.pages || {}).length;
  let buttonCount = 0;
  for (const page of Object.values(tree.pages || {})) {
    buttonCount += (page.buttons || []).length;
  }

  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(
    React.createElement(BoardViewer, {
      tree,
      showMessageBar: true,
      showBoardInfo: false, // hide page name / "N×M grid" info text
      derivePageBackground: true, // Grid 3 surround colour behind the keys
    })
  );

  return { pages: pageCount, buttons: buttonCount };
}

// Test hook: parse without rendering (used by Node smoke tests)
export async function inspectGridset(bytes, filename = 'keyboard.gridset') {
  const tree = await loadAACFile(toBuffer(bytes), filename);
  const pageCount = Object.keys(tree.pages || {}).length;
  let buttonCount = 0;
  for (const page of Object.values(tree.pages || {})) {
    buttonCount += (page.buttons || []).length;
  }
  return { pages: pageCount, buttons: buttonCount };
}

if (typeof globalThis !== 'undefined') {
  globalThis.BoardPreviewBundle = { previewGridset, inspectGridset };
}
