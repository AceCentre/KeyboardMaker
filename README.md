# KeyboardMaker

Make AAC keyboard gridsets (Grid 3) for any language — entirely in your browser.

A static site (GitHub Pages) — no server, nothing uploaded:

- **Keyman keyboards** — search by language, preview, and remap the bundled
  Grid 3 template with the keyboard's `.kvks` definition (fetched from
  [keymanapp/keyboards](https://github.com/keymanapp/keyboards)).
- **JSON layout library** — describe a keyboard as a simple row/key JSON
  layout (see [`layouts/README.md`](layouts/README.md); the Gujarati iOS
  Extended keyboard ships in [`layouts/`](layouts/)) and generate a gridset.
- **Live previews** — hover any search result to preview the actual keyboard
  (rendered with [aac-board-viewer](https://github.com/willwade/aac-board-viewer)),
  or open a full preview in a modal.
- **Verified output** — generated gridsets are validated with the processor's
  own validator and the check results are shown in the UI.

Built with [@willwade/aac-processors](https://www.npmjs.com/package/@willwade/aac-processors).

## Run locally

```bash
npm install
npm run build          # builds bundles into static/ and assembles docs/
cd docs && python3 -m http.server 8765   # any static file server works
# open http://localhost:8765
```

The site itself lives in [`docs/`](docs/) (served by GitHub Pages from the
`main` branch). `npm run build` refreshes the generated assets in `docs/`
(bundles, `kvks_index.json`, `template.gridset`, layouts manifest).

## Command line

```bash
# Generate a gridset from a JSON layout (validated after writing)
node scripts/generate-gridset.mjs layouts/gujarati-ios-extended.json out.gridset
```

## Repo layout

| Path | What |
|---|---|
| `docs/` | The static site (index.html, app.js, styles.css + generated assets) |
| `layouts/` | JSON layout library + format documentation |
| `scripts/` | Build scripts, layout→gridset engine, Keyman remap port |
| `static/` | Build output (copied into docs/) |
| `createindex.py` | Maintainer tool: rebuild `kvks_index.json` from a clone of keymanapp/keyboards |
| `template.gridset` | Grid 3 template remapped for Keyman keyboards |

## Adding a layout

Drop a JSON layout into `layouts/` (format in
[`layouts/README.md`](layouts/README.md)) and run `npm run build` — it appears
in searches. From the site itself you can also upload a layout and save it to
your browser's local library.
