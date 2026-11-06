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
 *     React BoardViewer into `container`.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BoardViewer, loadAACFile } from 'aac-board-viewer';

export async function previewGridset(container, bytes, filename = 'keyboard.gridset') {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const tree = await loadAACFile(buffer, filename);

  const pageCount = Object.keys(tree.pages || {}).length;
  let buttonCount = 0;
  for (const page of Object.values(tree.pages || {})) {
    buttonCount += (page.buttons || []).length;
  }

  const root = createRoot(container);
  root.render(
    React.createElement(BoardViewer, {
      tree,
      showMessageBar: true,
    })
  );

  return { pages: pageCount, buttons: buttonCount };
}

// Test hook: parse without rendering (used by Node smoke tests)
export async function inspectGridset(bytes, filename = 'keyboard.gridset') {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const tree = await loadAACFile(buffer, filename);
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
