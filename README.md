# KeyboardMaker
A streamlit app to make keyboards for AAC systems for any language

## Two ways to make a keyboard

1. **Keyman keyboards** — search [Keyman](http://keyman.com) keyboards by
   language and remap the bundled Grid 3 template (`.gridset`).
2. **Layout library (JSON)** — describe a keyboard as a simple row/key JSON
   layout (see [`layouts/README.md`](layouts/README.md); the Gujarati iOS
   Extended keyboard ships in [`layouts/`](layouts/)) and generate a Grid 3
   gridset **entirely in the browser** (with an interactive preview) or on
   the server.

Gridsets are generated with
[@willwade/aac-processors](https://www.npmjs.com/package/@willwade/aac-processors);
the in-app preview is rendered with
[aac-board-viewer](https://github.com/willwade/aac-board-viewer).

## Setup

```bash
# Python side
uv sync (or pip install -r requirements.txt)

# Node side (for the layout library: generator + preview bundles)
npm install
npm run build:browser   # builds static/layout-generator.js and static/board-preview.js
```

## Run

```bash
streamlit run streamlit.py
```

## Layout library from the command line

```bash
node scripts/generate-gridset.mjs layouts/gujarati-ios-extended.json out.gridset
```
