const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const COLOR_NAMES = ['green', 'red', 'yellow', 'blue', 'purple'];
const GUTTER_COLORS = {
  green: '#00b400',
  red: '#dc0000',
  yellow: '#dcc800',
  blue: '#0078dc',
  purple: '#a000dc',
};

let decorationTypes = {};
let tracked = new Map();
let lineCounts = new Map();
let watchers = [];
let selfWriting = false;

const RULER_LANE_MAP = {
  left: vscode.OverviewRulerLane.Left,
  center: vscode.OverviewRulerLane.Center,
  right: vscode.OverviewRulerLane.Right,
  full: vscode.OverviewRulerLane.Full,
};

function getHighlightsDir(workspaceFolder) {
  return path.join(workspaceFolder.uri.fsPath, '.vscode', 'highlights');
}

function highlightFileFromSourcePath(sourcePath, workspaceFolder) {
  const relative = path.relative(workspaceFolder.uri.fsPath, sourcePath);
  const encoded = relative.replace(/[\\/]/g, '__');
  return path.join(getHighlightsDir(workspaceFolder), encoded + '.json');
}

function parseLineSpec(lineSpec) {
  if (typeof lineSpec === 'number') return { start: lineSpec, end: lineSpec };
  if (typeof lineSpec === 'string' && lineSpec.includes('-')) {
    const [a, b] = lineSpec.split('-').map(Number);
    if (isNaN(a) || isNaN(b)) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  const n = Number(lineSpec);
  return isNaN(n) ? null : { start: n, end: n };
}

function itemsFromEntries(entries, maxLine) {
  const items = [];
  for (const entry of entries) {
    const color = entry.color || 'blue';
    if (!COLOR_NAMES.includes(color)) continue;
    const spec = parseLineSpec(entry.line);
    if (!spec) continue;
    for (let line = spec.start; line <= Math.min(spec.end, maxLine); line++) {
      items.push({
        color,
        note: entry.note || null,
        range: new vscode.Range(line - 1, 0, line - 1, 0),
      });
    }
  }
  return items;
}

// regroups per-line items into range entries
function buildEntries(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.color, item.note || '']);
    if (!grouped.has(key)) grouped.set(key, { color: item.color, note: item.note, lines: new Set() });
    grouped.get(key).lines.add(item.range.start.line + 1);
  }

  const entries = [];
  for (const { color, note, lines } of grouped.values()) {
    const sorted = [...lines].sort((a, b) => a - b);

    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      const entry = { line: i === j ? sorted[i] : `${sorted[i]}-${sorted[j]}`, color };
      if (note) entry.note = note;
      entries.push(entry);
      i = j + 1;
    }
  }

  entries.sort((a, b) => {
    const aLine = typeof a.line === 'number' ? a.line : Number(a.line.split('-')[0]);
    const bLine = typeof b.line === 'number' ? b.line : Number(b.line.split('-')[0]);
    return aLine - bLine;
  });
  return entries;
}

function writeHighlightsForFile(document, workspaceFolder) {
  const filePath = document.uri.fsPath;
  const items = tracked.get(filePath);
  const highlightFile = highlightFileFromSourcePath(filePath, workspaceFolder);

  if (!items || items.length === 0) {
    try { fs.unlinkSync(highlightFile); } catch {}
    return;
  }

  const json = JSON.stringify(buildEntries(items), null, 2) + '\n';
  try { if (fs.readFileSync(highlightFile, 'utf8') === json) return; } catch {}

  const dir = path.dirname(highlightFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  selfWriting = true;
  fs.writeFileSync(highlightFile, json);
  setTimeout(() => { selfWriting = false; }, 200);
}

function createDecorationTypes() {
  disposeDecorationTypes();
  const config = vscode.workspace.getConfiguration('lineHighlight');
  const gutterEnabled = config.get('gutterBar.enabled', false);

  const rulerPosition = config.get('overviewRuler.position', 'right');

  for (const color of COLOR_NAMES) {
    const bgColor = config.get(`colors.${color}`, `rgba(128, 128, 128, 0.15)`);
    const opts = {
      backgroundColor: bgColor,
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    };
    if (rulerPosition !== 'off') {
      opts.overviewRulerColor = GUTTER_COLORS[color];
      opts.overviewRulerLane = RULER_LANE_MAP[rulerPosition];
    }
    if (gutterEnabled) {
      opts.gutterIconSize = '100%';
      opts.borderWidth = '0 0 0 3px';
      opts.borderStyle = 'solid';
      opts.borderColor = GUTTER_COLORS[color];
    }
    decorationTypes[color] = vscode.window.createTextEditorDecorationType(opts);
  }
}

function disposeDecorationTypes() {
  for (const dt of Object.values(decorationTypes)) {
    dt.dispose();
  }
  decorationTypes = {};
}

function renderDecorations(editor) {
  if (!editor) return;
  const filePath = editor.document.uri.fsPath;
  const items = tracked.get(filePath) || [];

  for (const color of COLOR_NAMES) {
    const colorItems = items.filter(i => i.color === color);
    const decos = colorItems.map(item => {
      const deco = { range: item.range };
      if (item.note) deco.hoverMessage = new vscode.MarkdownString(item.note);
      return deco;
    });
    editor.setDecorations(decorationTypes[color], decos);
  }
}

function loadAndRender(editor) {
  if (!editor) return;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) return;

  const document = editor.document;
  const filePath = document.uri.fsPath;
  const highlightFile = highlightFileFromSourcePath(filePath, workspaceFolder);

  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(highlightFile, 'utf8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {}

  tracked.set(filePath, itemsFromEntries(entries, document.lineCount));
  lineCounts.set(filePath, document.lineCount);
  renderDecorations(editor);
}

function renderAll() {
  for (const editor of vscode.window.visibleTextEditors) {
    const filePath = editor.document.uri.fsPath;
    if (tracked.has(filePath)) {
      renderDecorations(editor);
    } else {
      loadAndRender(editor);
    }
  }
}

function reloadAll() {
  tracked.clear();
  for (const editor of vscode.window.visibleTextEditors) {
    loadAndRender(editor);
  }
}

function clearAllDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    for (const color of COLOR_NAMES) {
      if (decorationTypes[color]) {
        editor.setDecorations(decorationTypes[color], []);
      }
    }
  }
  tracked.clear();
}

function toggleHighlight(editor, color) {
  if (!editor) return;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) return;

  const filePath = editor.document.uri.fsPath;
  if (!tracked.has(filePath)) tracked.set(filePath, []);
  const items = tracked.get(filePath);

  const startLine = editor.selection.start.line;
  const endLine = editor.selection.end.line;

  for (let line = startLine; line <= endLine; line++) {
    const existing = items.findIndex(i => i.range.start.line === line && i.color === color);
    if (existing >= 0) {
      items.splice(existing, 1);
    } else {
      items.push({
        color,
        note: null,
        range: new vscode.Range(line, 0, line, 0),
      });
    }
  }

  renderDecorations(editor);
  writeHighlightsForFile(editor.document, workspaceFolder);
}

function removeHighlight(editor) {
  if (!editor) return;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) return;

  const filePath = editor.document.uri.fsPath;
  if (!tracked.has(filePath)) return;
  const items = tracked.get(filePath);

  const startLine = editor.selection.start.line;
  const endLine = editor.selection.end.line;

  for (let line = startLine; line <= endLine; line++) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].range.start.line === line) items.splice(i, 1);
    }
  }

  renderDecorations(editor);
  writeHighlightsForFile(editor.document, workspaceFolder);
}

function persistTracked(document) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;
  const filePath = document.uri.fsPath;
  if (!tracked.has(filePath)) return;

  const items = tracked.get(filePath);
  const valid = items.filter(item => item.range.start.line < document.lineCount);
  tracked.set(filePath, valid);
  writeHighlightsForFile(document, workspaceFolder);
}

// heuristic in-buffer line-shift, persisted on save; external edits are not tracked.
// caller guarantees the file has tracked items; returns true when a reload from JSON is needed
function shiftTrackedLines(document, contentChanges) {
  const filePath = document.uri.fsPath;
  const items = tracked.get(filePath);
  const prevCount = lineCounts.get(filePath);
  lineCounts.set(filePath, document.lineCount);
  if (!contentChanges.length) return false;

  // single change replacing the whole old doc = external reload, re-read positions from JSON
  const first = contentChanges[0];
  if (
    contentChanges.length === 1 &&
    first.range.start.line === 0 && first.range.start.character === 0 &&
    prevCount !== undefined && first.range.end.line >= prevCount - 1
  ) {
    return true;
  }

  for (const change of contentChanges) {
    const startLine = change.range.start.line;
    const endLine = change.range.end.line;
    const newLineCount = change.text.split('\n').length - 1;
    const delta = newLineCount - (endLine - startLine);
    if (delta === 0) continue;

    // char 0 to char 0 spans delete/insert whole lines; else the span edit is mid-line
    const wholeLine = change.range.start.character === 0 && change.range.end.character === 0;
    const dropFrom = wholeLine ? startLine : startLine + 1;
    const dropTo = wholeLine ? endLine - 1 : endLine;
    const shiftFrom = wholeLine ? endLine : endLine + 1;

    for (let i = items.length - 1; i >= 0; i--) {
      const line = items[i].range.start.line;
      if (line >= dropFrom && line <= dropTo) {
        items.splice(i, 1);
      } else if (line >= shiftFrom) {
        const moved = line + delta;
        items[i].range = new vscode.Range(moved, 0, moved, 0);
      }
    }
  }
  return false;
}

function setupWatchers(context) {
  for (const w of watchers) w.dispose();
  watchers = [];

  let debounceTimer = null;
  const debouncedReload = () => {
    if (selfWriting) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reloadAll(), 150);
  };

  for (const folder of vscode.workspace.workspaceFolders) {
    const pattern = new vscode.RelativePattern(folder, '.vscode/highlights/*.json');
    const w = vscode.workspace.createFileSystemWatcher(pattern);
    w.onDidChange(debouncedReload);
    w.onDidCreate(debouncedReload);
    w.onDidDelete(debouncedReload);
    watchers.push(w);
    context.subscriptions.push(w);
  }
}

function activate(context) {
  createDecorationTypes();

  for (const color of COLOR_NAMES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`lineHighlight.${color}`, () => {
        toggleHighlight(vscode.window.activeTextEditor, color);
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('lineHighlight.remove', () => {
      removeHighlight(vscode.window.activeTextEditor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lineHighlight.toggle', async () => {
      const color = await vscode.window.showQuickPick(COLOR_NAMES, { placeHolder: 'Pick highlight color' });
      if (color) toggleHighlight(vscode.window.activeTextEditor, color);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lineHighlight.clearAll', () => {
      clearAllDecorations();
      if (!vscode.workspace.workspaceFolders) return;
      for (const folder of vscode.workspace.workspaceFolders) {
        const dir = getHighlightsDir(folder);
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            if (file.endsWith('.json')) {
              fs.unlinkSync(path.join(dir, file));
            }
          }
        }
      }
    })
  );

  if (!vscode.workspace.workspaceFolders?.length) return;

  setupWatchers(context);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) loadAndRender(editor);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => renderAll())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      if (!tracked.get(e.document.uri.fsPath)?.length) return;
      const needsRemap = shiftTrackedLines(e.document, e.contentChanges);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document !== e.document) continue;
        if (needsRemap) {
          loadAndRender(editor);
        } else {
          renderDecorations(editor);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lineHighlight')) {
        createDecorationTypes();
        renderAll();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      persistTracked(document);
    })
  );

  reloadAll();
}

function deactivate() {
  for (const [filePath] of tracked) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
    if (doc) persistTracked(doc);
  }
  disposeDecorationTypes();
  tracked.clear();
}

module.exports = { activate, deactivate };
