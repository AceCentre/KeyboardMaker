/**
 * build-browser-bundle.mjs
 *
 * Bundle the in-browser gridset generator (scripts/browser-entry.mjs) into a
 * single self-contained IIFE file: static/layout-generator.js
 * exposing window.LayoutGenerator.generateGridset(layoutJson, options).
 *
 * The '@willwade/aac-processors' import in the shared lib is aliased to the
 * browser entry so no Node-only code (fs, adm-zip, better-sqlite3) is pulled in.
 */

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const browserEntry = require.resolve('@willwade/aac-processors/browser');

const outdir = path.resolve('static');
fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, 'layout-generator.js');

const result = await build({
  entryPoints: [path.resolve('scripts/browser-entry.mjs')],
  bundle: true,
  format: 'iife',
  globalName: 'LayoutGeneratorBundle',
  target: ['es2020'],
  minify: true,
  outfile,
  legalComments: 'none',
  logLevel: 'info',
  alias: {
    '@willwade/aac-processors': browserEntry,
    '@willwade/aac-processors/browser': browserEntry,
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

const kb = (fs.statSync(outfile).size / 1024).toFixed(1);
console.log(`Built ${outfile} (${kb} KB)`);
if (result.warnings.length > 0) {
  console.warn(`${result.warnings.length} esbuild warnings`);
}
