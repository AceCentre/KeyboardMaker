/**
 * browser-entry.mjs
 *
 * Browser-safe generator: layout JSON -> Grid 3 .gridset bytes, entirely
 * in-memory (no filesystem). Bundled by esbuild into static/layout-generator.js
 * as window.LayoutGenerator.
 *
 * Exposes:
 *   generateGridset(layoutObj, { includeWorkspace }) -> Promise<{ bytes: Uint8Array, filename, summary }>
 */

import { GridsetProcessor } from '@willwade/aac-processors/browser';
import { buildTree, summarize } from './layout-to-gridset.js';

export async function generateGridset(layout, { includeWorkspace = true } = {}) {
  const { tree, warnings } = buildTree(layout, { includeWorkspace });

  let captured = null;
  const processor = new GridsetProcessor({
    preserveAllButtons: true,
    fileAdapter: {
      // Minimal in-memory adapter: we only need saveFromTree's write step
      // and loadIntoTree/validate's read step (from captured bytes).
      readBinaryFromInput: async (input) => {
        if (input instanceof Uint8Array) return input;
        if (input instanceof ArrayBuffer) return new Uint8Array(input);
        if (captured && typeof input === 'string') return captured;
        throw new Error('File system access is not available in the browser.');
      },
      writeBinaryToPath: async (_outputPath, data) => {
        captured = data;
      },
      getFileSize: async (_path) => (captured ? captured.length : 0),
      join: (...parts) => parts.join('/'),
    },
  });

  await processor.saveFromTree(tree, 'output.gridset');
  if (!captured) throw new Error('Gridset generation produced no output.');

  // Verify with the processor's own validator (zip, grid XML, settings, FileMap)
  const validation = await processor.validate('output.gridset');

  // Reload the captured bytes to count buttons
  const reloaded = await processor.loadIntoTree(captured);
  const summary = summarize(reloaded, warnings);
  summary.validation = {
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    checks: validation.results.map((c) => ({ type: c.type, valid: c.valid })),
  };

  const safeName = String(layout.layout || 'keyboard')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase() || 'keyboard';

  return { bytes: captured, filename: `${safeName}.gridset`, summary };
}

// Expose a global when a bundler drops this into a page
if (typeof globalThis !== 'undefined') {
  globalThis.LayoutGenerator = { generateGridset };
}
