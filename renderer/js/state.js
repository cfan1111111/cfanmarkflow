/* MarkFlow - 全局状态 + 轻量事件总线 */
import { uid, basename } from './utils.js';

/**
 * 显示模式三态（单一数据源）：
 *   split —— 阅读和编辑：源码与预览左右并排，源码可编辑
 *   read  —— 阅读：只显示预览，编辑器隐藏且只读
 *   edit  —— 编辑：只显示源码（专注写作）
 * 旧的 viewMode（editor/preview/split）与 tab.mode（edit/read）两层概念已合并至此。
 */
export const VALID_MODES = ['split', 'read', 'edit'];

export function normalizeMode(m) {
  return VALID_MODES.includes(m) ? m : 'split';
}

export const state = {
  settings: null,
  recent: [],
  workingDir: '',
  tabs: [],
  activeId: null,
  sortBy: 'name',
  theme: 'light',
};

export function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

export function findTabByPath(p) {
  return state.tabs.find((t) => t.path && t.path === p) || null;
}

export function createTab({ path = null, name = null, content = '', mode = 'split' } = {}) {
  const tab = {
    id: uid(),
    path,
    name: name || (path ? basename(path) : '未命名.md'),
    content,
    savedContent: content,
    dirty: false,
    mode: normalizeMode(mode),
    bom: false,
    encoding: 'utf-8',
    mtime: 0,
    cmState: null, // CodeMirror EditorState 快照
    cursor: { line: 0, col: 0 },
    scrollTop: 0,
  };
  state.tabs.push(tab);
  return tab;
}

export function removeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i === -1) return;
  state.tabs.splice(i, 1);
  if (state.activeId === id) {
    const next = state.tabs[i] || state.tabs[i - 1] || null;
    state.activeId = next ? next.id : null;
  }
}

/* 简易事件总线 */
const listeners = {};
export function on(event, cb) {
  (listeners[event] ||= []).push(cb);
  return () => { listeners[event] = (listeners[event] || []).filter((f) => f !== cb); };
}
export function emit(event, ...args) {
  (listeners[event] || []).forEach((cb) => { try { cb(...args); } catch (e) { console.error(e); } });
}
