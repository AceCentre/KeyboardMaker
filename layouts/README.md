# Layout Library

Row/key JSON layouts that can be turned into Grid 3 `.gridset` files.
Every `.json` file in this folder appears in the app's **Layout library** tab.

## Format

```json
{
  "layout": "Gujarati iOS Extended Grid",
  "locale": "gu-IN",
  "description": "Optional description",
  "workspace": true,
  "rows": [
    {
      "row_index": 1,
      "keys": [
        { "position": 1, "type": "action", "label": "Tab / Arrow", "value": "⇥" },
        { "position": 2, "type": "character", "label": "ક", "value": "ક" },
        { "position": 12, "type": "action", "label": "Delete", "value": "⌫" }
      ]
    }
  ]
}
```

### Top-level fields

| Field | Required | Notes |
|---|---|---|
| `layout` | yes | Name of the keyboard (used as the gridset name) |
| `locale` | no | BCP-47-ish code written to the gridset language settings (default `en-US`) |
| `description` | no | Free text |
| `workspace` | no | `true` (default) adds a chat workspace (message bar) row at the top |
| `rows` | yes | Array of rows (single-page layout) |
| `pages` | instead of `rows` | Optional multi-page variant: `[{ "name": "...", "rows": [...] }]` plus an optional `root` naming the start page |

### Rows and keys

- `row_index`: 1-based, contiguous row number.
- `position`: 1-based column within the row. The grid width is the largest
  `position` used; gaps are left empty.
- `type`: `"character"` (inserts `value` as text) or `"action"` (special key).
- `label`: what appears on the key.
- `value`: what the key inserts (characters) or identifies the action (actions).
- `states`: optional per-key modifier variants (see below).

### Key states (shift / opt layers)

Any key may define `states` — per-modifier variants. State names are modifier
names joined by `_` in canonical order (`shift`, `ctrl`, `alt`, `opt`), e.g.
`"shift"`, `"opt"`, `"shift_opt"`. When any key defines states, the generator
expands the layout into one Grid 3 page per state (same geometry), and any
action key recognisable as a modifier (`⇧`/Shift, `⌃`/Ctrl, `⌥`/Alt/Option)
becomes a `Jump.To` toggle between the layers — Grid 3's native model for
modifier layers. Keys without a variant for a layer inherit their base value.

```json
{ "position": 3, "type": "character", "label": "e", "value": "e",
  "states": {
    "shift":     { "label": "E", "value": "E" },
    "opt":       { "label": "é", "value": "é" },
    "shift_opt": { "label": "É", "value": "É" }
  } }
```

Toggling is XOR-style: `⇧` on the default layer jumps to `shift`, `⇧` on
`shift` returns to default, `⌥` on `shift` jumps to `shift_opt`, and so
on. Place the modifier keys in your rows like any other action key — the
generator wires them per layer. Explicit `pages` and `states` cannot be
combined. See `layouts/english-qwerty-states-demo.json` for a full example.

### Action keys

Actions are recognised by their label/value:

| Label / value | Grid 3 command |
|---|---|
| Delete, ⌫ | `Action.DeleteLetter` |
| Return / Enter, ↵ | `Action.Enter` |
| Spacebar, " " | `Action.Space` |
| Tab, ⇥ | `ComputerControl.Keyboard {TAB}` (desktop only) |
| Symbols, `!1?123`, `#+=` | `Jump.To` a page whose name contains "symbols", if one exists |
| Globe, 🌐 | `Settings.GridExplorer` |
| Dictation, 🎤 | caption only (no Grid 3 equivalent — reported as a warning) |
| Hide Keyboard, ⌨️ | caption only (no Grid 3 equivalent — reported as a warning) |

Character keys map to `Action.Letter` (single code point), `Action.Punctuation`
(ASCII punctuation) or `Action.InsertText` (multi-code-point values such as
conjuncts `ક્ષ` or clusters like `ઓૅ`).

## Generating

From the app: **Layout library (JSON)** tab → pick a layout → generate in the
browser or on the server.

From the command line:

```bash
node scripts/generate-gridset.mjs layouts/gujarati-ios-extended.json out.gridset
node scripts/generate-gridset.mjs layout.json out.gridset --no-workspace
```

The generated file is re-parsed after writing to validate it.
