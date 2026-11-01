/* MarkFlow - 编辑器（CodeMirror 6）：高亮、查找替换、快捷输入、工具栏命令、围栏语言补全 */
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection,
  dropCursor, highlightActiveLineGutter, rectangularSelection,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import {
  syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching,
  foldGutter, foldKeymap, LanguageDescription, LanguageSupport, StreamLanguage, HighlightStyle,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion, startCompletion, closeBrackets, closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';

/* ---------- 代码块语言（用于编辑器内嵌高亮 + 围栏语言补全） ---------- */
import { javascript as jsMode, json as jsonMode, typescript as tsMode } from '@codemirror/legacy-modes/mode/javascript';
import { python as pyMode } from '@codemirror/legacy-modes/mode/python';
import { go as goMode } from '@codemirror/legacy-modes/mode/go';
import { rust as rustMode } from '@codemirror/legacy-modes/mode/rust';
import * as clike from '@codemirror/legacy-modes/mode/clike';
import { sql as sqlMode } from '@codemirror/legacy-modes/mode/sql';
import { yaml as yamlMode } from '@codemirror/legacy-modes/mode/yaml';
import { shell as shellMode } from '@codemirror/legacy-modes/mode/shell';
import { css as cssMode } from '@codemirror/legacy-modes/mode/css';
import { xml as xmlMode } from '@codemirror/legacy-modes/mode/xml';

const sl = (m) => StreamLanguage.define(m);
const LM = {
  javascript: sl(jsMode), typescript: sl(tsMode || jsMode), json: sl(jsonMode),
  python: sl(pyMode), go: sl(goMode), rust: sl(rustMode),
  cpp: sl(clike.cpp), c: sl(clike.cpp), java: sl(clike.java || clike.cpp),
  sql: sl(sqlMode), yaml: sl(yamlMode),
  bash: sl(shellMode), sh: sl(shellMode), css: sl(cssMode), html: sl(xmlMode),
  'c++': sl(clike.cpp), 'c#': sl(clike.csharp || clike.cpp), jsonc: sl(jsonMode),
};
export const LANG_NAMES = Object.keys(LM);

const codeLanguages = Object.entries(LM).map(([name, sup]) =>
  LanguageDescription.of({
    name,
    alias: [name],
    extensions: [name.toLowerCase()],
    load: async () => new LanguageSupport(sup),
  }),
);

/* ---------- 主题（使用 CSS 变量，自动跟随页面明暗） ---------- */
const mdTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--cm-font-size)', color: 'var(--cm-fg)', backgroundColor: 'var(--cm-bg)' },
  '.cm-scroller': { fontFamily: 'var(--cm-font)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--cm-cursor)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--cm-bg)', color: 'var(--cm-gutter)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--cm-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--cm-active)' },
  '.cm-foldGutter': { color: 'var(--cm-gutter)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cm-cursor)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--cm-selection)',
  },
  '.cm-matchingBracket': { backgroundColor: 'var(--cm-match)', outline: '1px solid var(--cm-match-bd)' },
  '.cm-searchMatch': { backgroundColor: 'var(--cm-search)' },
  '.cm-tooltip': { backgroundColor: 'var(--cm-tooltip)', color: 'var(--cm-fg)', border: '1px solid var(--cm-border)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--cm-active)', color: 'var(--cm-fg)' },
  '.cm-panels': { backgroundColor: 'var(--cm-bg)', color: 'var(--cm-fg)' },
  '.cm-completionIcon': { color: 'var(--cm-gutter)' },
}, { dark: false });

const mdHighlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--cm-heading)', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold', color: 'var(--cm-strong)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--cm-em)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--cm-link)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--cm-link)' },
  { tag: t.monospace, color: 'var(--cm-code)' },
  { tag: t.quote, color: 'var(--cm-quote)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--cm-list)' },
  { tag: t.keyword, color: 'var(--cm-kw)' },
  { tag: t.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--cm-string)' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: t.bool, color: 'var(--cm-kw)' },
  { tag: t.function(t.variableName), color: 'var(--cm-fn)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--cm-attr)' },
  { tag: t.typeName, color: 'var(--cm-type)' },
  { tag: t.operator, color: 'var(--cm-op)' },
  { tag: t.meta, color: 'var(--cm-comment)' },
]);

/* ---------- 围栏语言补全 ---------- */
function fenceLangCompletions(context) {
  const before = context.matchBefore(/```\w*/);
  if (!before) return null;
  const lineStart = context.state.doc.lineAt(before.from).from;
  if (before.from !== lineStart) return null;
  const typed = before.text.slice(3);
  const options = LANG_NAMES.map((n) => ({ label: n, type: 'keyword' }));
  return { from: before.from + 3, options, validFor: /^\w*$/ };
}

/* ---------- 快捷输入（E4） ---------- */
let applyingQuick = false;

function applyQuickInput(view, change, prevSel) {
  const { state } = view;
  const doc = state.doc;
  const at = change.from;
  const line = doc.lineAt(at);
  const prefix = line.text.slice(0, at - line.from);

  // 1. 选中文字后输入包裹符号
  const wraps = { '**': '**', '*': '*', '`': '`', '~~': '~~' };
  if (!prevSel.empty && Object.prototype.hasOwnProperty.call(wraps, change.text)) {
    const selText = doc.sliceString(prevSel.from, prevSel.to);
    const w = wraps[change.text];
    const from = prevSel.from, to = change.to;
    applyingQuick = true;
    view.dispatch({
      changes: { from, to, insert: `${w}${selText}${w}` },
      selection: { anchor: from + w.length, head: from + w.length + selText.length },
    });
    applyingQuick = false;
    return true;
  }

  // 2. []() 展开为 [文本](链接)
  if (change.text === ')' && at >= 3) {
    const head = doc.sliceString(at - 3, at);
    if (head === '[](') {
      const insert = '[文本](链接)';
      applyingQuick = true;
      view.dispatch({
        changes: { from: at - 3, to: at + 1, insert },
        selection: { anchor: at - 3 + 1, head: at - 3 + 1 + 2 }, // 选中“文本”
      });
      applyingQuick = false;
      return true;
    }
  }

  // 3. 标题自动补全：行首输入 #
  if (change.text === '#' && prefix === '') {
    const hashes = line.text.match(/^#+/);
    const n = Math.min(hashes ? hashes[0].length : 1, 6);
    const rest = line.text.replace(/^#+\s?/, '');
    const newLine = `${'#'.repeat(n)} ${rest}`;
    applyingQuick = true;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newLine },
      selection: { anchor: line.from + newLine.length },
    });
    applyingQuick = false;
    return true;
  }

  // 4. 列表标记后空格规范化
  if (change.text === ' ' && /^([-*+]|\d+\.)$/.test(prefix)) {
    const marker = prefix.endsWith('.') ? prefix + ' ' : `${prefix[0]} `;
    applyingQuick = true;
    view.dispatch({
      changes: { from: line.from, to: line.from + prefix.length, insert: marker },
      selection: { anchor: line.from + marker.length },
    });
    applyingQuick = false;
    return true;
  }

  // 5. ``` 展开为代码块骨架
  if (line.text === '```') {
    const newText = '```lang\n\n```';
    applyingQuick = true;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
      selection: { anchor: line.from + 3, head: line.from + 7 },
      effects: [],
    });
    applyingQuick = false;
    startCompletion(view);
    return true;
  }
  return false;
}

/* ---------- 回车在列表内智能续行（E4） ---------- */
function handleEnter(view) {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

  let m = /^(\s*)([-*+]) \[([ xX])\] (.*)$/.exec(before);
  if (m) {
    const [, ind, mark, , rest] = m;
    if (rest.trim() === '') return replaceLine(view, line, '');
    return insertAfter(view, sel.head, `${ind}- [ ] `);
  }
  m = /^(\s*)([-*+]) (.*)$/.exec(before);
  if (m) {
    const [, ind, mark, rest] = m;
    if (rest.trim() === '') return replaceLine(view, line, '');
    return insertAfter(view, sel.head, `${ind}${mark} `);
  }
  m = /^(\s*)(\d+)\. (.*)$/.exec(before);
  if (m) {
    const [, ind, num, rest] = m;
    if (rest.trim() === '') return replaceLine(view, line, '');
    return insertAfter(view, sel.head, `${ind}${parseInt(num, 10) + 1}. `);
  }
  return false;
}
function replaceLine(view, line, text) {
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text } });
  return true;
}
/** 在光标处（而非行尾）断行插入续行标记，保证光标位于行中时行为正确 */
function insertAfter(view, pos, text) {
  view.dispatch({
    changes: { from: pos, insert: `\n${text}` },
    selection: { anchor: pos + 1 + text.length },
  });
  return true;
}

/* ---------- 工具栏命令 ---------- */
function wrap(view, before, after) {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty) {
    view.dispatch({
      changes: { from: sel.head, insert: `${before}${after}` },
      selection: { anchor: sel.head + before.length },
    });
  } else {
    const text = state.sliceDoc(sel.from, sel.to);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${before}${text}${after}` },
      selection: { anchor: sel.from + before.length, head: sel.from + before.length + text.length },
    });
  }
  view.focus();
}
function getSelectedLines(view) {
  const { state } = view;
  const ranges = state.selection.ranges;
  const lines = new Set();
  for (const r of ranges) {
    const a = state.doc.lineAt(r.from), b = state.doc.lineAt(r.to);
    for (let i = a.number; i <= b.number; i++) lines.add(state.doc.line(i));
  }
  return Array.from(lines);
}
function toggleLinePrefix(view, prefix) {
  const lines = getSelectedLines(view);
  const changes = [];
  for (const ln of lines) {
    if (ln.text.startsWith(prefix)) changes.push({ from: ln.from, to: ln.from + prefix.length, insert: '' });
    else changes.push({ from: ln.from, insert: prefix });
  }
  view.dispatch({ changes });
  view.focus();
}
function toggleOrdered(view) {
  const lines = getSelectedLines(view);
  const changes = [];
  let n = 1;
  for (const ln of lines) {
    const m = /^(\s*)(\d+)\. (.*)$/.exec(ln.text);
    if (m) changes.push({ from: ln.from, to: ln.from + m[1].length + m[2].length + 2, insert: '' });
    else changes.push({ from: ln.from, insert: `${n}. ` });
    n++;
  }
  view.dispatch({ changes });
  view.focus();
}
function setHeading(view, level) {
  const lines = getSelectedLines(view);
  const changes = [];
  for (const ln of lines) {
    const m = /^(#{1,6})\s?(.*)$/.exec(ln.text);
    const content = m ? m[2] : ln.text;
    const repl = level ? `${'#'.repeat(level)} ${content}` : content;
    changes.push({ from: ln.from, to: ln.to, insert: repl });
  }
  view.dispatch({ changes });
  view.focus();
}
function changeHeading(view, delta) {
  const lines = getSelectedLines(view);
  const changes = [];
  for (const ln of lines) {
    const m = /^(#{1,6})\s?(.*)$/.exec(ln.text);
    const cur = m ? m[1].length : 0;
    let lvl = Math.max(0, Math.min(6, cur + delta));
    const content = m ? m[2] : ln.text;
    changes.push({ from: ln.from, to: ln.to, insert: lvl ? `${'#'.repeat(lvl)} ${content}` : content });
  }
  view.dispatch({ changes });
  view.focus();
}
function insertLink(view, isImage) {
  const { state } = view;
  const sel = state.selection.main;
  const text = sel.empty ? '文本' : state.sliceDoc(sel.from, sel.to);
  const inner = isImage ? `![${text}](链接)` : `[${text}](链接)`;
  const urlStart = inner.indexOf('链接');
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: inner },
    selection: { anchor: sel.from + urlStart, head: sel.from + urlStart + 2 },
  });
  view.focus();
}
function insertBlock(view, text) {
  const { state } = view;
  const sel = state.selection.main;
  const at = sel.head;
  const line = state.doc.lineAt(at);
  const needsNl = at > line.from && !line.text.slice(0, at - line.from).endsWith('\n');
  const insert = (needsNl ? '\n' : '') + text;
  const caret = at + insert.length - (text.endsWith('\n') ? 1 : 0);
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: caret },
  });
  view.focus();
}

const TABLE = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 单元格 | 单元格 | 单元格 |\n| 单元格 | 单元格 | 单元格 |\n';

export const cmds = {
  bold: (v) => wrap(v, '**', '**'),
  italic: (v) => wrap(v, '*', '*'),
  strike: (v) => wrap(v, '~~', '~~'),
  code: (v) => wrap(v, '`', '`'),
  link: (v) => insertLink(v, false),
  image: (v) => insertLink(v, true),
  heading1: (v) => setHeading(v, 1),
  heading2: (v) => setHeading(v, 2),
  heading3: (v) => setHeading(v, 3),
  headingUp: (v) => changeHeading(v, 1),
  headingDown: (v) => changeHeading(v, -1),
  quote: (v) => toggleLinePrefix(v, '> '),
  ul: (v) => toggleLinePrefix(v, '- '),
  ol: (v) => toggleOrdered(v),
  task: (v) => toggleLinePrefix(v, '- [ ] '),
  table: (v) => insertBlock(v, TABLE),
  codeblock: (v) => insertBlock(v, '```\n\n```'),
  hr: (v) => insertBlock(v, '---\n'),
};

/* ---------- 创建编辑器 ---------- */
const fontCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

export function createEditor(parent, handlers = {}) {
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    foldGutter(),
    rectangularSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages, addKeymap: true }),
    syntaxHighlighting(mdHighlight, { fallback: true }),
    autocompletion({ override: [fenceLangCompletions], activateOnTyping: false }),
    highlightSelectionMatches(),
    mdTheme,
    readOnlyCompartment.of(EditorState.readOnly.of(false)),
    fontCompartment.of(EditorView.theme({}, { dark: false })),
    keymap.of([
      { key: 'Enter', run: handleEnter },
      { key: 'Tab', run: indentWithTab },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return;
      if (update.docChanged) {
        // 仅处理用户单次输入触发的快捷输入
        const userTr = update.transactions.find((tr) => tr.docChanged && tr.isUserEvent('input'));
        if (userTr && !applyingQuick) {
          let change = null;
          userTr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            if (change === null && !inserted.toString().includes('\n')) {
              change = { from: fromB, to: toB, text: inserted.toString() };
            }
          });
          const prevSel = userTr.startState.selection.main;
          if (change) applyQuickInput(update.view, change, prevSel);
        }
        if (handlers.onChange) handlers.onChange(update.view);
      }
      if (update.selectionSet || update.docChanged) {
        if (handlers.onCursor) handlers.onCursor(update.view);
      }
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });
  return {
    view,
    setState(doc, cursor = null) {
      view.setState(EditorState.create({
        doc,
        extensions,
        selection: cursor != null ? { anchor: cursor } : undefined,
      }));
    },
    setReadOnly(ro) { view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)) }); },
    /** 滚动到指定行（1-based）并把光标放到该行行首 */
    scrollToLine(lineNo) {
      if (!lineNo || lineNo < 1) return;
      const doc = view.state.doc;
      const n = Math.min(lineNo, doc.lines);
      const pos = doc.line(n).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start' }),
      });
      view.focus();
    },
    setFont(fontSize, fontFamily, codeFamily) {
      const theme = EditorView.theme({
        '&': { fontSize: `${fontSize}px` },
        '.cm-scroller': { fontFamily: `"${codeFamily}", var(--cm-font)` },
        '.cm-content': { fontFamily: `"${fontFamily}", var(--cm-font)` },
      }, { dark: false });
      view.dispatch({ effects: fontCompartment.reconfigure(theme) });
    },
  };
}

export function getCursor(view) {
  const p = view.state.doc.lineAt(view.state.selection.main.head);
  return { line: p.number, col: view.state.selection.main.head - p.from + 1 };
}

/* 供菜单调用的编辑操作 */
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
export function editUndo(view) { undo(view); view.focus(); }
export function editRedo(view) { redo(view); view.focus(); }
export function openFind(view) { view.focus(); openSearchPanel(view); }
export function openReplace(view) { view.focus(); openSearchPanel(view); }
