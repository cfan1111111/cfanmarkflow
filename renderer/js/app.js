/* MarkFlow - 应用主控制器 */
import {
  state, getActiveTab, findTabByPath, createTab, removeTab, on, emit,
  VALID_MODES, normalizeMode,
} from './state.js';
import { $, $$, debounce, escapeHtml, basename, dirname, countWords, confirmDialog, toast, cssEscape } from './utils.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';
import { createEditor, getCursor, cmds, editUndo, editRedo, openFind, openReplace } from './editor.js';
import { renderMarkdown, initPreview, buildSignatureHtml } from './preview.js';
import { createFileTree } from './fileTree.js';
import { createTabs } from './tabs.js';
import { createToc } from './toc.js';
import { createDirSearch } from './searchDir.js';
import { createSettings, FONT_MAPS } from './settingsUI.js';
import { createAbout } from './about.js';
import { createWelcome } from './welcome.js';

const api = window.api;

/* ---------- 模块实例 ---------- */
let editor, fileTree, tabsCtl, tocCtl, dirSearch, settingsUI, aboutUI, welcome, previewEl;
const previewScroll = () => $('#preview-pane');

/* ---------- 目录监视生命周期（修复：旧版 watch:stop 丢参数导致监视器只增不减） ---------- */
function watchDirOf(filePath) { return filePath ? dirname(filePath) : ''; }
function tabsInDir(dir) { return dir ? state.tabs.filter((t) => t.path && watchDirOf(t.path) === dir).length : 0; }
function startWatch(dir) { if (dir) api.watchStart(dir); }
function stopWatch(dir) { if (dir && tabsInDir(dir) === 0) api.watchStop(dir); }

/* ---------- 主题 / 字体 ---------- */
function effectiveTheme() {
  const th = state.settings.theme;
  if (th === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return th;
}
function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
}
function applyFonts() {
  const s = state.settings;
  const body = FONT_MAPS.FONT_BODY[s.fontFamily] || FONT_MAPS.FONT_BODY.system;
  const code = FONT_MAPS.FONT_CODE[s.codeFontFamily] || FONT_MAPS.FONT_CODE.consolas;
  const root = document.documentElement.style;
  root.setProperty('--font-body', body);
  root.setProperty('--font-code', code);
  root.setProperty('--font-size', s.fontSize + 'px');
  editor && editor.setFont(s.fontSize, body, code);
}

function applySettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (patch.theme !== undefined) applyTheme();
  if (patch.fontSize !== undefined || patch.fontFamily !== undefined || patch.codeFontFamily !== undefined) applyFonts();
  if (patch.showFileTree !== undefined) {
    $('#sidebar').style.display = patch.showFileTree ? '' : 'none';
    $('#sidebar-rail').style.display = patch.showFileTree ? 'none' : '';
  }
  if (patch.showToc !== undefined) {
    $('#toc-panel').style.display = patch.showToc ? '' : 'none';
    $('#toc-rail').style.display = patch.showToc ? 'none' : '';
  }
  // 署名相关变更 → 立即重绘预览末尾的落款
  if (patch.signatureEnabled !== undefined || patch.signatureName !== undefined || patch.signatureEmail !== undefined) {
    if (getActiveTab()) renderNow();
  }
  api.setSettings(patch);
}

/* ---------- 渲染预览（带防抖，大文件延长间隔，N2） ---------- */
const renderPreview = debounce(() => {
  const tab = getActiveTab();
  if (!tab) return;
  const { html, toc } = renderMarkdown(tab.content, { docPath: tab.path || '' });
  // 落款附加在预览末尾，独立于 markdown 内容，不会写回 .md 源文件
  const sigHtml = buildSignatureHtml(state.settings || {});
  previewEl.innerHTML = html + sigHtml;
  tocCtl.render(toc);
  tab._toc = toc;
}, 160);

function renderNow() {
  const tab = getActiveTab();
  if (!tab) return;
  const big = tab.content.length >= 100 * 1024;
  if (big) setTimeout(renderPreview, 250); else renderPreview();
}

/* ---------- 显示模式（阅读 / 编辑 / 阅读和编辑） ---------- */
/** 当前生效的显示模式：无标签时回落到 split */
function currentMode() {
  const tab = getActiveTab();
  return tab ? normalizeMode(tab.mode) : 'split';
}
/** 新打开文档时采用的默认模式（设置项 defaultMode） */
function defaultMode() {
  const m = state.settings && state.settings.defaultMode;
  return normalizeMode(m);
}
function modeLabelKey(mode) {
  return mode === 'read' ? 'tb.modeRead' : mode === 'edit' ? 'tb.modeEdit' : 'tb.modeSplit';
}
function modeStatusKey(mode) {
  return mode === 'read' ? 'st.modeRead' : mode === 'edit' ? 'st.modeEdit' : 'st.modeSplit';
}
/**
 * 旧会话模式兼容：旧版 tab.mode 只有 'edit'/'read' 两值，
 * 其中 'edit' 表示"可编辑"（配合 viewMode=split 实际并排显示），映射为新的 'split'。
 */
function legacyMode(m) {
  if (m === 'read') return 'read';
  if (m === 'edit') return 'split';
  return normalizeMode(m);
}

/**
 * 布局：按三态显示模式决定哪些窗格可见
 *   read  → 只有预览（编辑器隐藏、只读）
 *   edit  → 只有源码（专注写作，编辑器占满整宽）
 *   split → 源码 + 预览并排（可边写边看）
 */
function applyLayout() {
  const tab = getActiveTab();
  const panes = $('#panes');
  if (!tab) { panes.hidden = true; return; }

  const mode = normalizeMode(tab.mode);
  const edPane = $('#editor-pane');
  const pvPane = $('#preview-pane');
  const splitter = $('#splitter');
  const mdTb = $('#md-toolbar');
  const modeBtn = $('#btn-mode');

  // 阅读模式下没有编辑器，Markdown 格式工具栏无意义
  mdTb.style.display = mode === 'read' ? 'none' : '';
  modeBtn.querySelector('span').textContent = t(modeLabelKey(mode));

  panes.hidden = false;
  if (mode === 'read') {
    edPane.style.display = 'none';
    edPane.style.flex = '';          // 复位，避免下一模式残留固定宽度
    pvPane.style.display = '';
    pvPane.style.flex = '1 1 auto';
    splitter.style.display = 'none';
  } else if (mode === 'edit') {
    edPane.style.display = '';
    edPane.style.flex = '1 1 auto';   // 占满整宽，右侧不留空白栏
    edPane.style.borderRight = 'none';
    pvPane.style.display = 'none';
    pvPane.style.flex = '';
    splitter.style.display = 'none';
  } else {
    edPane.style.display = '';
    edPane.style.borderRight = '';
    pvPane.style.display = '';
    pvPane.style.flex = '';
    splitter.style.display = '';
    applySplitRatio(state.settings.splitRatio);
  }
  updateStatus();
}

function applySplitRatio(r) {
  const edPane = $('#editor-pane');
  edPane.style.flex = `0 0 ${Math.round(r * 100)}%`;
}

/* ---------- 标签 / 文件 ---------- */
const openInFlight = new Map(); // path -> Promise，防止并发打开同一文件产生重复标签
async function openFile(filePath, { line, col, reveal = true } = {}) {
  if (!filePath || !/\.(md|markdown)$/i.test(filePath)) return;
  if (openInFlight.has(filePath)) return openInFlight.get(filePath);
  const task = (async () => {
    let tab = findTabByPath(filePath);
    if (tab) {
      state.activeId = tab.id;
    } else {
      const res = await api.readFile(filePath);
      if (!res.ok) { toast(t('msg.openFail') + '：' + res.error, 'error'); return; }
      tab = createTab({ path: filePath, name: basename(filePath), content: res.content, mode: defaultMode() });
      tab.bom = res.bom; tab.encoding = res.encoding; tab.mtime = res.mtime;
      tab.savedContent = res.content;
      state.activeId = tab.id;
      api.addRecent(filePath, basename(filePath));
      startWatch(watchDirOf(filePath));
    }
    refreshTabs();
    fileTree.setActive(filePath);
    activateTab(tab, { line, col, reveal });
    const r = await api.getRecent();
    state.recent = r || state.recent;
  })();
  openInFlight.set(filePath, task);
  try { await task; } finally { openInFlight.delete(filePath); }
}

function newFile() {
  const tab = createTab({ name: '未命名.md', content: '', mode: defaultMode() });
  state.activeId = tab.id;
  refreshTabs();
  activateTab(tab);
}

let lastSelfSaveAt = 0; // 自己保存后短时间内忽略监视事件，避免误弹“外部修改”
async function saveActive(saveAs = false) {
  const tab = getActiveTab();
  if (!tab) return;
  let path = tab.path;
  if (saveAs || !path) {
    const p = await api.saveFileDialog(path || '未命名.md');
    if (!p) return;
    if (!/\.(md|markdown)$/i.test(p)) path = p + '.md';
    else path = p;
    tab.path = path; tab.name = basename(path);
    startWatch(watchDirOf(path));
  }
  tab.content = editor.view.state.doc.toString();
  const res = await api.writeFile(path, tab.content, tab.bom, tab.encoding);
  if (!res.ok) { toast(t('msg.saveFail') + '：' + res.error, 'error'); return; }
  if (res.converted && res.converted !== tab.encoding) {
    tab.encoding = res.converted;
    toast(t('msg.encodingUpgraded'));
  }
  tab.savedContent = tab.content;
  tab.mtime = res.mtime;
  tab.dirty = false;
  lastSelfSaveAt = Date.now();
  api.addRecent(path, tab.name);
  refreshTabs();
  fileTree.setActive(path);
  setTitle();
  updateStatus();
  toast(t('msg.saved'));
}

async function closeTab(id) {
  const tab = state.tabs.find((x) => x.id === id);
  if (!tab) return;
  if (tab.dirty) {
    const ok = await confirmDialog(t('msg.confirmClose'), { okText: '关闭（不保存）', cancelText: t('msg.cancel') });
    if (!ok) return;
  }
  const closingPath = tab.path;
  if (state.activeId === id && editor) tab.cmState = editor.view.state;
  removeTab(id);
  // 该目录已无其他打开的标签时才释放监视（引用计数语义）
  if (closingPath) stopWatch(watchDirOf(closingPath));
  refreshTabs();
  if (state.activeId) {
    const next = getActiveTab();
    if (next) activateTab(next);
  } else {
    editor.view.setState(editor.view.state.update({ doc: '' }).state);
    previewEl.innerHTML = '';
    tocCtl.render([]);
    $('#panes').hidden = true;
    welcome.setRecent(state.recent);
    welcome.show();
  }
}

function refreshTabs() {
  tabsCtl.render(state.tabs, state.activeId);
  if (state.activeId) $('#btn-newtab').style.display = '';
}

function activateTab(tab, { line, col, reveal } = {}) {
  welcome.hide();
  // 保存上一个标签的编辑器状态
  const prev = getActiveTab();
  if (prev && prev.id !== tab.id && editor) prev.cmState = editor.view.state;

  state.activeId = tab.id;
  tabsCtl.setActive(tab.id);
  fileTree.setActive(tab.path || '');

  // 装载内容到编辑器
  if (tab.cmState) editor.view.setState(tab.cmState);
  else editor.setState(tab.content || '');

  const readOnly = normalizeMode(tab.mode) === 'read';
  editor.setReadOnly(readOnly);

  // 定位行
  if (typeof line === 'number' && line > 0) {
    const doc = editor.view.state.doc;
    const ln = Math.min(line, doc.lines);
    const p = doc.line(ln).from;
    editor.view.dispatch({ selection: { anchor: p }, scrollIntoView: true });
  }
  // 触发 onChange 以初始化 tab.content 与预览
  tab.content = editor.view.state.doc.toString();
  renderNow();
  applyLayout();
  setTitle();
  updateStatus();
  if (reveal !== false && !readOnly) editor.view.focus();
}

function setTitle() {
  const tab = getActiveTab();
  if (!tab) { document.title = t('app.name'); api.setWindowTitle(t('app.name')); return; }
  const title = `${tab.name}${tab.dirty ? ' *' : ''} — ${t('app.name')}`;
  document.title = title;
  api.setWindowTitle(title);
}

function updateStatus() {
  const tab = getActiveTab();
  $('#st-mode').textContent = tab ? t(modeStatusKey(normalizeMode(tab.mode))) : '';
  $('#st-encoding').textContent = tab ? `${t('st.encoding')}: ${tab.encoding ? tab.encoding.toUpperCase() : 'UTF-8'}` : '';
  if (tab) {
    const words = countWords(tab.content);
    $('#st-words').textContent = `${t('st.words')}: ${words}`;
    const c = getCursor(editor.view);
    $('#st-cursor').textContent = `${t('st.cursor')}: ${c.line}, ${c.col}`;
    const dirty = tab.dirty;
    $('#st-saved').textContent = dirty ? t('st.unsaved') : t('st.saved');
    $('#st-saved').classList.toggle('dirty', dirty);
    $('#st-path').textContent = tab.path || tab.name;
  } else {
    $('#st-words').textContent = ''; $('#st-cursor').textContent = ''; $('#st-saved').textContent = '';
    $('#st-path').textContent = '';
  }
}

/* ---------- 编辑事件 ---------- */
function onEditorChange(view) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.content = view.state.doc.toString();
  tab.dirty = tab.content !== tab.savedContent;
  if (tab.dirty) { tabsCtl.render(state.tabs, state.activeId); setTitle(); }
  updateStatus();
  renderNow();
}
function onEditorCursor() { updateStatus(); syncTocToCursor(); }

/* ---------- 模式与视图 ---------- */
/**
 * 设置当前标签的显示模式。
 * read → 预览只读；edit / split → 源码可编辑（split 时与预览同屏）
 */
function setMode(mode) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.mode = normalizeMode(mode);
  editor.setReadOnly(tab.mode === 'read');
  applyLayout();
  setTitle();
  toast(t(modeStatusKey(tab.mode)), 'info');
}
/** F2：三态循环 split → read → edit → split */
function toggleMode() {
  const tab = getActiveTab();
  if (!tab) return;
  const cur = normalizeMode(tab.mode);
  const next = VALID_MODES[(VALID_MODES.indexOf(cur) + 1) % VALID_MODES.length];
  setMode(next);
}

/* ---------- 外部修改 / 文件树刷新 ---------- */
async function reloadTab(tab) {
  const res = await api.readFile(tab.path);
  if (!res.ok) return;
  tab.content = res.content; tab.savedContent = res.content; tab.mtime = res.mtime; tab.dirty = false;
  tab.cmState = null;
  if (tab.id === state.activeId) {
    editor.setState(tab.content || '');
    renderNow(); setTitle();
  }
  tabsCtl.render(state.tabs, state.activeId);
}

const debouncedTreeRefresh = debounce(() => fileTree.refresh(), 400);

async function onFileChanged(path) {
  // 自己刚保存触发的监视事件：忽略，避免误报“外部修改”
  if (Date.now() - lastSelfSaveAt < 1500) return;
  const tab = findTabByPath(path);
  if (tab) {
    if (!tab.dirty) { await reloadTab(tab); toast('已重新加载外部修改的文件'); }
    else showExternalChangeBar(tab);
  }
}
function showExternalChangeBar(tab) {
  const bar = $('#external-change-bar');
  bar.hidden = false;
  bar.dataset.id = tab.id;
  bar.querySelector('.ext-text').textContent = `${tab.name}：${t('msg.externalChange')}`;
}

/* ---------- 任务列表回写（P4） ---------- */
function toggleTask(lineNo) {
  const tab = getActiveTab();
  if (!tab || !editor) return;
  const view = editor.view;
  if (lineNo > view.state.doc.lines) return;
  const ln = view.state.doc.line(lineNo);
  const m = /^(\s*[-*+] \[)([ xX])(\])/.exec(ln.text);
  if (!m) return;
  const ch = m[2] === ' ' ? 'x' : ' ';
  view.dispatch({ changes: { from: ln.from + m[1].length, to: ln.from + m[1].length + 1, insert: ch } });
  tab.content = view.state.doc.toString();
  tab.dirty = tab.content !== tab.savedContent;
  tabsCtl.render(state.tabs, state.activeId); setTitle(); updateStatus();
  renderNow();
}

/* ---------- TOC 跳转与滚动联动 ---------- */
/**
 * 目录跳转。
 * 编辑模式下预览区是隐藏的，scrollIntoView 对隐藏元素无效，
 * 因此改为跳转到编辑器中该标题的源行并定位光标。
 */
function jumpToSlug(slug) {
  const tab = getActiveTab();
  const mode = tab ? normalizeMode(tab.mode) : 'split';
  const item = tab && tab._toc ? tab._toc.find((x) => x.slug === slug) : null;

  if (mode === 'edit') {
    // 编辑模式：预览区隐藏，仅跳转编辑器并定位光标
    if (item && editor) editor.scrollToLine(item.line);
  } else if (mode === 'read') {
    // 阅读模式：仅跳转预览区
    const el = previewEl.querySelector(`#${cssEscape(slug)}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('toc-flash'); setTimeout(() => el.classList.remove('toc-flash'), 900); }
  } else {
    // split 模式：编辑栏与阅读栏同时跳转
    if (item && editor) editor.scrollToLine(item.line);
    const el = previewEl.querySelector(`#${cssEscape(slug)}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('toc-flash'); setTimeout(() => el.classList.remove('toc-flash'), 900); }
  }

  tocCtl.setActive(slug);
}
let scrollThrottle = null;
function onPreviewScroll() {
  if (scrollThrottle) return;
  scrollThrottle = setTimeout(() => {
    scrollThrottle = null;
    const tab = getActiveTab();
    if (!tab || !tab._toc) return;
    const top = previewEl.getBoundingClientRect().top + 20;
    let active = null;
    for (const it of tab._toc) {
      const el = previewEl.querySelector(`#${cssEscape(it.slug)}`);
      if (el && el.getBoundingClientRect().top <= top) active = it.slug; else break;
    }
    if (active) tocCtl.setActive(active);
  }, 120);
}

/**
 * 编辑模式下的目录高亮跟随：按光标所在行找出最近的上级标题。
 * 让「点目录跳转」和「滚动时高亮」在编辑模式下行为一致。
 */
function syncTocToCursor() {
  const tab = getActiveTab();
  if (!tab || !tab._toc || !tab._toc.length) return;
  if (normalizeMode(tab.mode) !== 'edit') return;
  const cursorLine = getCursor(editor.view).line;
  let active = null;
  for (const it of tab._toc) {
    if (it.line && it.line <= cursorLine) active = it.slug; else break;
  }
  if (active) tocCtl.setActive(active);
}

/* ---------- 会话持久化（N5） ---------- */
const saveSession = debounce(() => {
  const active = getActiveTab();
  const data = {
    workingDir: state.workingDir,
    activeIndex: state.tabs.findIndex((x) => x.id === state.activeId),
    tabs: state.tabs.map((tab) => ({
      path: tab.path, name: tab.name, content: tab.content,
      savedContent: tab.savedContent, mode: tab.mode, dirty: tab.dirty,
      bom: tab.bom, encoding: tab.encoding,
    })),
  };
  api.saveSession(data);
}, 800);

function collectSession() {
  const data = {
    workingDir: state.workingDir,
    activeIndex: state.tabs.findIndex((x) => x.id === state.activeId),
    tabs: state.tabs.map((tab) => ({
      path: tab.path, name: tab.name, content: tab.content,
      savedContent: tab.savedContent, mode: tab.mode, dirty: tab.dirty,
      bom: tab.bom, encoding: tab.encoding,
    })),
  };
  return data;
}

/* ---------- 自动保存（F5） ---------- */
let autosaveTimer = null;
const autosaveWarned = new Set(); // 已提示过“未命名无法自动保存”的标签
function setupAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = null;
  if (state.settings.autosave) {
    autosaveTimer = setInterval(async () => {
      const tab = getActiveTab();
      if (tab && tab.dirty && tab.path) { await saveActive(false); toast(t('msg.autosaved'), 'info'); }
      else if (tab && tab.dirty && !tab.path && !autosaveWarned.has(tab.id)) {
        autosaveWarned.add(tab.id);
        toast(t('msg.autosaveUnnamed'), 'warn');
      }
    }, Math.max(5, state.settings.autosaveInterval) * 1000);
  }
}

/* ---------- 拖拽打开（F6） ---------- */
function setupDragDrop() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; overlay.hidden = false; });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('dragleave', (e) => { e.preventDefault(); depth--; if (depth <= 0) { overlay.hidden = true; depth = 0; } });
  document.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; overlay.hidden = true;
    const files = e.dataTransfer.files;
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      try { const p = api.getPathForFile(files[i]); if (p) paths.push(p); } catch { /* noop */ }
    }
    const mdFiles = paths.filter((p) => /\.(md|markdown)$/i.test(p));
    for (const p of mdFiles) await openFile(p);
    if (!mdFiles.length && paths.length && /\.(md|markdown)$/i.test(paths[0])) await openFile(paths[0]);
  });
}

/* ---------- 键盘快捷键 ---------- */
function setupShortcuts() {
  document.addEventListener('keydown', async (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'o') { e.preventDefault(); await pickOpen(); }
    else if (ctrl && k === 'n') { e.preventDefault(); newFile(); }
    else if (ctrl && k === 's' && !e.shiftKey) { e.preventDefault(); await saveActive(false); }
    else if (ctrl && k === 's' && e.shiftKey) { e.preventDefault(); await saveActive(true); }
    else if (ctrl && k === 'f' && e.shiftKey) { e.preventDefault(); dirSearch.toggle(); }
    else if (ctrl && k === 't' && e.shiftKey) { e.preventDefault(); toggleTheme(); }
    else if (ctrl && k === 'l' && e.shiftKey) { e.preventDefault(); togglePanel('sidebar'); }
    else if (ctrl && k === 'o' && e.shiftKey) { e.preventDefault(); togglePanel('toc-panel'); }
    else if (k === 'f2') { e.preventDefault(); toggleMode(); }
  });
}

function toggleTheme() {
  const order = { light: 'dark', dark: 'light', system: 'light' };
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applySettings({ theme: next });
  toast(next === 'dark' ? '深色主题' : '浅色主题');
}
function togglePanel(id) {
  const el = document.getElementById(id);
  const show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  // 面板收起时显示对应的边缘恢复栏，再次点击即可展开
  const railId = id === 'sidebar' ? 'sidebar-rail' : 'toc-rail';
  const rail = document.getElementById(railId);
  if (rail) rail.style.display = show ? 'none' : '';
  if (id === 'sidebar') applySettings({ showFileTree: show });
  if (id === 'toc-panel') applySettings({ showToc: show });
}

/* ---------- 对话框 ---------- */
async function pickOpen() {
  const paths = await api.openFileDialog();
  for (const p of paths) await openFile(p);
}
async function pickOpenDir() {
  const d = await api.openDirDialog();
  if (d) setWorkingDir(d);
}
async function setWorkingDir(dir, sortBy) {
  const prevDir = state.workingDir;
  state.workingDir = dir;
  if (sortBy) state.sortBy = sortBy;
  if (state.settings.treeSortBy && !sortBy) sortBy = state.settings.treeSortBy;
  else if (sortBy) applySettings({ treeSortBy: sortBy });
  $('#dir-path').textContent = dir;
  await fileTree.setDir(dir, state.sortBy);
  // 切换目录：旧目录无打开标签时释放监视，再监视新目录
  if (prevDir && prevDir !== dir) stopWatch(prevDir);
  startWatch(dir);
}

/* ---------- 菜单动作 ---------- */
function setupMenuActions() {
  api.onMenuAction((action) => {
    switch (action) {
      case 'file:new': newFile(); break;
      case 'file:open': pickOpen(); break;
      case 'file:openDir': pickOpenDir(); break;
      case 'file:save': saveActive(false); break;
      case 'file:saveAs': saveActive(true); break;
      case 'file:closeTab': if (state.activeId) closeTab(state.activeId); break;
      case 'edit:undo': if (editor) editUndo(editor.view); break;
      case 'edit:redo': if (editor) editRedo(editor.view); break;
      case 'edit:find': if (editor) openFind(editor.view); break;
      case 'edit:replace': if (editor) openReplace(editor.view); break;
      case 'edit:cut': document.execCommand('cut'); break;
      case 'edit:copy': document.execCommand('copy'); break;
      case 'edit:paste': document.execCommand('paste'); break;
      case 'edit:selectAll': document.execCommand('selectAll'); break;
      case 'view:toggleMode': toggleMode(); break;
      case 'view:previewOnly': setMode('read'); break;
      case 'view:editorOnly': setMode('edit'); break;
      case 'view:split': setMode('split'); break;
      case 'view:toggleTheme': toggleTheme(); break;
      case 'view:toggleFileTree': togglePanel('sidebar'); break;
      case 'view:toggleToc': togglePanel('toc-panel'); break;
      case 'view:zoomIn': changeZoom(1); break;
      case 'view:zoomOut': changeZoom(-1); break;
      case 'view:zoomReset': applySettings({ fontSize: 14 }); break;
      case 'tools:searchDir': dirSearch.toggle(); break;
      case 'tools:settings': settingsUI.open(); break;
      case 'tools:registerAssoc': api.registerFileAssoc().then((r) => toast(r && r.ok ? t('msg.assocOn') : (r && r.error || '失败'))); break;
      case 'tools:unregisterAssoc': api.unregisterFileAssoc().then((r) => toast(r && r.ok ? t('msg.assocOff') : (r && r.error || '失败'))); break;
      case 'help:about': aboutUI.open(); break;
      case 'app:quit': window.close(); break;
      default:
        if (action.startsWith('tree:')) handleTreeAction(action);
    }
  });

  api.onOpenFiles((paths) => { for (const p of paths) openFile(p); });
  api.onFileChanged((p) => onFileChanged(p));
  api.onWatchError((msg) => console.warn('watch error', msg));
  api.onTreeChanged(() => debouncedTreeRefresh());
  document.addEventListener('beforeunload', () => { api.saveSessionSync(collectSession()); });
  previewScroll().addEventListener('scroll', onPreviewScroll);
}

function changeZoom(delta) {
  const cur = state.settings.fontSize;
  const next = Math.max(12, Math.min(24, cur + delta));
  applySettings({ fontSize: next });
}

function handleTreeAction(action) {
  // 形如 tree:open@<path> / tree:reveal@<path> / tree:copyPath@<path>
  const kind = action.split(':')[1].split('@')[0];
  const path = decodeURIComponent(action.split('@')[1] || '');
  if (kind === 'open') openFile(path);
  else if (kind === 'reveal') api.revealInFolder(path);
  else if (kind === 'copyPath') { if (navigator.clipboard) navigator.clipboard.writeText(path); toast('已复制路径'); }
}

/* ---------- 分屏拖拽 ---------- */
function setupSplitter() {
  const splitter = $('#splitter');
  const panes = $('#panes');
  let dragging = false;
  splitter.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = panes.getBoundingClientRect();
    let r = (e.clientX - rect.left) / rect.width;
    r = Math.max(0.2, Math.min(0.8, r));
    applySplitRatio(r);
    state.settings.splitRatio = r;
  });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.cursor = ''; api.setSettings({ splitRatio: state.settings.splitRatio }); } });
}

/* ---------- 工具栏 ---------- */
function setupToolbar() {
  $('#btn-open').onclick = pickOpen;
  $('#btn-new').onclick = newFile;
  $('#btn-save').onclick = () => saveActive(false);
  $('#btn-mode').onclick = toggleMode;
  $('#btn-search-dir').onclick = () => dirSearch.toggle();
  $('#btn-theme').onclick = toggleTheme;
  $('#btn-settings').onclick = () => settingsUI.open();
  $('#btn-newtab').onclick = newFile;
  $('#btn-change-dir').onclick = pickOpenDir;
  $('#btn-sort').onclick = () => {
    const next = state.sortBy === 'name' ? 'mtime' : 'name';
    state.sortBy = next;
    applySettings({ treeSortBy: next });
    fileTree.setSort(next);
  };
  $('#btn-tree-collapse').onclick = () => togglePanel('sidebar');
  $('#btn-toc-collapse').onclick = () => togglePanel('toc-panel');
  // 折叠后的边缘恢复栏：点击重新展开对应侧边栏
  $('#sidebar-rail').onclick = () => togglePanel('sidebar');
  $('#toc-rail').onclick = () => togglePanel('toc-panel');
  // 外部修改条按钮
  $('#external-change-bar .ext-reload').onclick = async () => {
    const id = $('#external-change-bar').dataset.id;
    const tab = state.tabs.find((x) => x.id === id);
    $('#external-change-bar').hidden = true;
    if (tab) await reloadTab(tab);
  };
  $('#external-change-bar .ext-ignore').onclick = () => { $('#external-change-bar').hidden = true; };

  // Markdown 编辑工具栏（E5）
  const map = {
    '#tb-bold': 'bold', '#tb-italic': 'italic', '#tb-strike': 'strike', '#tb-code': 'code',
    '#tb-link': 'link', '#tb-image': 'image', '#tb-heading-up': 'headingUp', '#tb-heading-down': 'headingDown',
    '#tb-quote': 'quote', '#tb-ul': 'ul', '#tb-ol': 'ol', '#tb-task': 'task',
    '#tb-table': 'table', '#tb-codeblock': 'codeblock', '#tb-hr': 'hr',
  };
  for (const [sel, cmd] of Object.entries(map)) {
    const el = $(sel);
    if (el) el.onclick = () => { cmds[cmd](editor.view); onEditorChange(editor.view); };
  }
}

/* ---------- 初始化 ---------- */
async function init() {
  state.settings = await api.getSettings();
  state.recent = await api.getRecent();
  setLang(state.settings.language);
  applyI18n(document);
  applyTheme();

  previewEl = $('#preview');
  initPreview(previewEl, {
    onTaskToggle: toggleTask,
    openExternal: (url) => api.openExternal(url),
  });

  editor = createEditor($('#editor-host'), { onChange: onEditorChange, onCursor: onEditorCursor });

  fileTree = createFileTree($('#file-tree'), {
    onOpen: openFile,
    onContext: (path, x, y) => showTreeContext(path),
    onDirChanged: () => {},
  });
  tabsCtl = createTabs($('#tabs'), {
    onActivate: (id) => { const tab = state.tabs.find((x) => x.id === id); if (tab) activateTab(tab); },
    onClose: (id) => closeTab(id),
    onContext: (id, x, y) => showTabContext(id, x, y),
  });
  tocCtl = createToc($('#toc'), { onJump: jumpToSlug });
  dirSearch = createDirSearch($('#dir-search-panel'), {
    getDir: () => state.workingDir,
    onOpenFileAtLine: (path, line, col) => openFile(path, { line, col }),
  });
  settingsUI = createSettings($('#modal'), {
    getSettings: () => state.settings,
    onChange: applySettings,
    onAbout: () => aboutUI.open(),
  });
  aboutUI = createAbout($('#about-modal'), {
    getSettings: () => state.settings,
    onChange: applySettings,
  });

  applyFonts();
  setupToolbar();
  setupShortcuts();
  setupMenuActions();
  setupSplitter();
  setupDragDrop();
  setupAutosave();

  /* 全局兜底：未捕获异常 / 未处理 Promise 拒绝统一落盘到 userData/logs，便于定位“经常报错” */
  window.addEventListener('error', (e) => {
    api.logError('renderer.error', `${e.message || 'unknown'} @ ${e.filename || '?'}:${e.lineno || 0}:${e.colno || 0}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    api.logError('renderer.unhandledRejection', (r && r.stack) || String(r));
  });

  $('#sidebar').style.display = state.settings.showFileTree ? '' : 'none';
  $('#toc-panel').style.display = state.settings.showToc ? '' : 'none';
  $('#sidebar-rail').style.display = state.settings.showFileTree ? 'none' : '';
  $('#toc-rail').style.display = state.settings.showToc ? 'none' : '';

  // 会话恢复（N5）
  const session = await api.getSession();
  let sessionTabs = [];
  let sessionActive = 0;
  if (session && Array.isArray(session.tabs) && session.tabs.length) {
    sessionTabs = session.tabs;
    sessionActive = session.activeIndex || 0;
    if (session.workingDir) state.workingDir = session.workingDir;
  }
  // 监视系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'system') applyTheme(); });

  if (state.workingDir) {
    setWorkingDir(state.workingDir, state.settings.treeSortBy);
  }

  if (sessionTabs.length) {
    for (const s of sessionTabs) {
      const tab = createTab({ path: s.path, name: s.name, content: s.content, mode: legacyMode(s.mode) });
      tab.savedContent = s.savedContent != null ? s.savedContent : s.content;
      tab.dirty = !!s.dirty;
      tab.bom = !!s.bom; tab.encoding = s.encoding || 'utf-8';
      if (s.path) startWatch(watchDirOf(s.path));
    }
    if (state.tabs.length) {
      const idx = Math.min(sessionActive, state.tabs.length - 1);
      activateTab(state.tabs[idx]);
      refreshTabs();
      welcome.hide();
    }
  } else {
    welcome.setRecent(state.recent);
    welcome.show();
  }
  setupAutosave();

  // 冷启动：主动拉取主进程待打开的文件（修复首次双击 .md 不打开的竞态）。
  // 此时编辑器/标签/文件树均已就绪，openFile 可正常打开待打开的 .md。
  const initialFiles = await api.getInitialFiles();
  for (const p of initialFiles) openFile(p);
}

/* ---------- 上下文菜单 ---------- */
async function showTreeContext(path) {
  const items = [
    { label: t('tb.open'), action: `tree:open@${encodeURIComponent(path)}` },
    { label: '在资源管理器中显示', action: `tree:reveal@${encodeURIComponent(path)}` },
    { label: '复制路径', action: `tree:copyPath@${encodeURIComponent(path)}` },
  ];
  const a = await api.showContextMenu(items);
  if (a) routeContext(a);
}
async function showTabContext(id) {
  const items = [
    { label: t('msg.save'), action: `tab:save@${id}` },
    { label: '关闭', action: `tab:close@${id}` },
    { label: '关闭其他', action: `tab:closeOthers@${id}` },
    { label: '关闭全部', action: 'tab:closeAll' },
  ];
  const a = await api.showContextMenu(items);
  if (a) routeContext(a);
}
function routeContext(action) {
  if (action.startsWith('tree:')) handleTreeAction(action);
  else if (action.startsWith('tab:')) routeTabAction(action);
}
function routeTabAction(action) {
  if (action === 'tab:closeAll') { while (state.tabs.length) closeTab(state.tabs[0].id); return; }
  const [kind, id] = action.replace('tab:', '').split('@');
  const tab = state.tabs.find((x) => x.id === id);
  if (!tab) return;
  if (kind === 'save') { state.activeId = id; saveActive(false); }
  else if (kind === 'close') closeTab(id);
  else if (kind === 'closeOthers') {
    const keep = id;
    [...state.tabs].forEach((t) => { if (t.id !== keep) closeTab(t.id); });
  }
}

/* cssEscape 已统一由 utils.js 提供（支持数字开头/中文 slug） */

/* 把 welcome 在 init 末尾注入 */
function _initWelcome() {
  welcome = createWelcome($('#welcome'), {
    onNew: newFile,
    onOpen: pickOpen,
    onOpenDir: pickOpenDir,
    onOpenRecent: (p) => openFile(p),
  });
}

_initWelcome();
init();

// 测试 / 调试钩子（不影响正常功能）
window.MarkFlow = {
  openFile, newFile, saveActive, setWorkingDir, toggleMode, setMode,
  getState: () => state, api,
  getCursorLine: () => (editor ? getCursor(editor.view).line : 0),
  openAbout: () => aboutUI.open(),
};
