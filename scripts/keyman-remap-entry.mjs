/**
 * keyman-remap-entry.mjs
 *
 * Browser bundle entry for the Keyman template remap.
 * Bundled by esbuild into static/keyman-remap.js, which sets
 * window.KeymanRemap = { buildKeymanGridset, parseKvksContent,
 *                         guessGridLanguage, GRID_SUPPORTED_LANGUAGES }.
 *
 * Note: this is a side-effect bundle (no exports) — esbuild's IIFE wrapper
 * returns undefined for re-export-only entries, which would clobber the
 * globalThis assignment when combined with a globalName. See
 * scripts/build-browser-bundle.mjs.
 */

import {
  buildKeymanGridset,
  parseKvksContent,
  guessGridLanguage,
  GRID_SUPPORTED_LANGUAGES,
} from './keyman-remap.mjs';

globalThis.KeymanRemap = {
  buildKeymanGridset,
  parseKvksContent,
  guessGridLanguage,
  GRID_SUPPORTED_LANGUAGES,
};
