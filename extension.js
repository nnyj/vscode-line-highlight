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

function expandLines(lineSpec) {
  if (typeof lineSpec === 'number') return [lineSpec];
  if (typeof lineSpec === 'string' && lineSpec.includes('-')) {
    const [start, end] = lineSpec.split('-').map(Number);
    if (isNaN(start) || isNaN(end)) return [];
    const lines = [];
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      lines.push(i);
    }
    return lines;
  }
  const n = Number(lineSpec);
  return isNaN(n) ? [] : [n];
}

function loadHighlightsForFile(filePath, workspaceFolder) {
  const highlightFile = highlightFileFromSourcePath(filePath, workspaceFolder);
  try {
    const content = fs.readFileSync(highlightFile, 'utf8');
    const entries = JSON.parse(content);
    if (!Array.isArray(entries)) return [];

    const items = [];
    for (const entry of entries) {
      const color = entry.color || 'blue';
      if (!COLOR_NAMES.includes(color)) continue;
      for (const line of expandLines(entry.line)) {
        const zeroLine = Math.max(0, line - 1);
        items.push({
          color,
          note: entry.note || null,
          range: new vscode.Range(zeroLine, 0, zeroLine, 0),
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

function writeHighlightsForFile(filePath, workspaceFolder) {
  const items = tracked.get(filePath);
  const highlightFile = highlightFileFromSourcePath(filePath, workspaceFolder);
  const dir = path.dirname(highlightFile);

  if (!items || items.length === 0) {
    try { fs.unlinkSync(highlightFile); } catch {}
    return;
  }

  const grouped = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.color, item.note || '']);
    if (!grouped.has(key)) grouped.set(key, { color: item.color, note: item.note, lines: [] });
    grouped.get(key).lines.push(item.range.start.line + 1);
  }

  const entries = [];
  for (const { color, note, lines } of grouped.values()) {
    lines.sort((a, b) => a - b);

    let i = 0;
    while (i < lines.length) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
      const entry = { line: i === j ? lines[i] : `${lines[i]}-${lines[j]}`, color };
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

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  selfWriting = true;
  fs.writeFileSync(highlightFile, JSON.stringify(entries, null, 2) + '\n');
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

  const filePath = editor.document.uri.fsPath;
  const items = loadHighlightsForFile(filePath, workspaceFolder);
  tracked.set(filePath, items);
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
  writeHighlightsForFile(filePath, workspaceFolder);
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
  writeHighlightsForFile(filePath, workspaceFolder);
}

function persistTracked(document) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;
  const filePath = document.uri.fsPath;
  if (!tracked.has(filePath)) return;

  const items = tracked.get(filePath);
  const valid = items.filter(item => item.range.start.line < document.lineCount);
  tracked.set(filePath, valid);
  writeHighlightsForFile(filePath, workspaceFolder);
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
