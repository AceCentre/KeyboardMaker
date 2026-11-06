/**
 * build-browser-bundle.mjs
 *
 * Bundles the in-browser tools into self-contained IIFE files under static/:
 *
 *   static/layout-generator.js  -> window.LayoutGeneratorBundle
 *     Layout JSON -> Grid 3 .gridset bytes, entirely in-memory.
 *
 *   static/board-preview.js    -> window.BoardPreviewBundle
 *     Renders the generated .gridset with aac-board-viewer (React bundled).
 *     The viewer's CSS is inlined and injected at runtime so the bundle
 *     stays a single file.
 *
 * The '@willwade/aac-processors' import is aliased to the browser entry so no
 * Node-only code (fs, adm-zip, better-sqlite3) is pulled in.
 */

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const browserEntry = require.resolve('@willwade/aac-processors/browser');
const viewerStyles = require.resolve('aac-board-viewer/styles');

const alias = {
  '@willwade/aac-processors': browserEntry,
  '@willwade/aac-processors/browser': browserEntry,
};

const common = {
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  alias,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// --- 1. generator bundle ----------------------------------------------------
const generatorOut = path.resolve('static/layout-generator.js');
fs.mkdirSync(path.resolve('static'), { recursive: true });
await build({
  ...common,
  entryPoints: [path.resolve('scripts/browser-entry.mjs')],
  globalName: 'LayoutGeneratorBundle',
  outfile: generatorOut,
});
console.log(`Built ${generatorOut} (${kb(fs.statSync(generatorOut).size)})`);

// --- 2. preview bundle (aac-board-viewer) -----------------------------------
// CSS import emits a sibling .css file which we inline into the JS bundle.
const previewDir = path.resolve('static/.preview-build');
fs.rmSync(previewDir, { recursive: true, force: true });
fs.mkdirSync(previewDir, { recursive: true });
const previewOut = path.join(previewDir, 'board-preview.js');
await build({
  ...common,
  entryPoints: [path.resolve('scripts/preview-entry.mjs')],
  globalName: 'BoardPreviewBundle',
  outfile: previewOut,
});

const cssPath = previewOut.replace(/\.js$/, '.css');
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : fs.readFileSync(viewerStyles, 'utf-8');
const js = fs.readFileSync(previewOut, 'utf-8');
const injectCss = `(function(){if(typeof document==='undefined')return;var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();`;
const previewFinal = path.resolve('static/board-preview.js');
fs.writeFileSync(previewFinal, injectCss + js);
fs.rmSync(previewDir, { recursive: true, force: true });
console.log(`Built ${previewFinal} (${kb(fs.statSync(previewFinal).size)})`);
