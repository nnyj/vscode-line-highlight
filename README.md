# Line Highlight

Highlight editor lines from JSON files. Highlights are file-based, not stored in VSCode internal state, so they work with version control, external tools, and AI assistants.

![sample](images/sample.png)

## Claude Code / AI assistant setup

Add this to your `CLAUDE.md` or `AGENTS.md`:

```
Line highlights (vscode extension):
- When emphasizing lines in editor, write `.vscode/highlights/<path__to__file.ext>.json`
- Format: `[{"line": 1, "color": "green", "note": "optional"}]`
- Colors: green, red, yellow, blue, purple
- Ranges: `"line": "3-7"`, `__` = path separator in filename
```

Any tool that writes the JSON file triggers the extension via file watcher:

```sh
echo '[{"line": 42, "color": "red"}]' > .vscode/highlights/src__app.py.json
```

## Features

- Full line background highlighting with 5 named colors
- File-based: plain JSON in `.vscode/highlights/`, git-committable, no VSCode Settings Sync needed
- Tool-friendly: AI assistants, scripts, CI can write highlights programmatically
- Right-click context menu to highlight/remove
- Command palette toggle with color picker
- Highlights track line positions through edits (auto-shift on insert/delete)
- Overview ruler marks near scrollbar
- Optional gutter bar
- All colors configurable
- Multi-root workspace support

## How it works

Highlights are stored in `.vscode/highlights/<path>.json` per workspace. Filename maps to source file with `__` as path separator:

```
.vscode/highlights/src__app.py.json  →  src/app.py
```

### JSON format

```json
[
  {"line": 12, "color": "red", "note": "optional hover tooltip"},
  {"line": "3-7", "color": "green"}
]
```

| Field | Type | Description |
|-------|------|-------------|
| `line` | `number` or `"start-end"` | Line number (1-based) or range |
| `color` | `string` | `green`, `red`, `yellow`, `blue`, `purple` |
| `note` | `string` | Optional hover tooltip |

### Context menu

Right-click any line or selection → "Line Highlight" → pick color. Same color again removes it.

### Command palette

`Ctrl+Shift+P` → "Line Highlight: Toggle Highlight on Line" → pick color.

`Ctrl+Shift+P` → "Line Highlight: Clear All Highlights" → removes all highlights and deletes JSON files.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `lineHighlight.gutterBar.enabled` | `false` | Show colored gutter bar |
| `lineHighlight.overviewRuler.position` | `right` | Ruler position: `left`, `center`, `right`, `full`, `off` |
| `lineHighlight.colors.green` | `rgba(0, 180, 0, 0.15)` | Green background color |
| `lineHighlight.colors.red` | `rgba(220, 0, 0, 0.15)` | Red background color |
| `lineHighlight.colors.yellow` | `rgba(220, 200, 0, 0.15)` | Yellow background color |
| `lineHighlight.colors.blue` | `rgba(0, 120, 220, 0.15)` | Blue background color |
| `lineHighlight.colors.purple` | `rgba(160, 0, 220, 0.15)` | Purple background color |

## Install

```sh
npm run package
code --install-extension line-highlight-0.0.1.vsix
```

## License

[MIT](LICENSE)
