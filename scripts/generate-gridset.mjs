#!/usr/bin/env node
/**
 * generate-gridset.mjs
 *
 * Build a Grid 3 .gridset from a row/key keyboard layout JSON file
 * (e.g. layouts/gujarati-ios-extended.json) using @willwade/aac-processors.
 *
 * Usage:
 *   node scripts/generate-gridset.mjs <layout.json> <output.gridset> [--no-workspace]
 *
 * Prints "---SUMMARY---" followed by a JSON summary on stdout
 * (so callers can strip processor debug output).
 */

import fs from 'node:fs';
import path from 'node:path';
import { GridsetProcessor } from '@willwade/aac-processors';
import { buildTree, summarize } from './layout-to-gridset.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length < 2) {
  console.error('Usage: node scripts/generate-gridset.mjs <layout.json> <output.gridset> [--no-workspace]');
  process.exit(2);
}

const [inputPath, outputPath] = positional;

async function main() {
  const raw = fs.readFileSync(path.resolve(inputPath), 'utf-8');
  let layout;
  try {
    layout = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse layout JSON: ${err.message}`);
  }

  const includeWorkspace = layout.workspace !== false && !flags.has('--no-workspace');
  const { tree, warnings } = buildTree(layout, {
    includeWorkspace,
    fallbackName: path.basename(inputPath, '.json'),
  });

  const processor = new GridsetProcessor({ preserveAllButtons: true });
  await processor.saveFromTree(tree, outputPath);

  // Verify with the processor's own validator (zip, grid XML, settings, FileMap)
  const validation = await processor.validate(outputPath);

  // Reload to count buttons for the summary
  const reloaded = await processor.loadIntoTree(outputPath);
  const summary = summarize(reloaded, warnings, {
    output: outputPath,
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      checks: validation.results.map((c) => ({ type: c.type, valid: c.valid })),
    },
  });

  console.log('---SUMMARY---');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
