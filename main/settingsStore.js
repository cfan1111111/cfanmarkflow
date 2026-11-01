/**
 * MarkFlow - 设置持久化（userData/settings.json）
 */
const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  theme: 'system',            // 'system' | 'light' | 'dark'
  language: 'zh-CN',          // 'zh-CN' | 'en'
  fontFamily: 'system',       // 'system' | 'yahei' | 'simsun' | 'dengxian'
  codeFontFamily: 'consolas', // 'consolas' | 'cascadia' | 'jetbrains'
  fontSize: 14,               // 12 - 24
  autosave: true,
  autosaveInterval: 30,       // 秒
  splitRatio: 0.5,            // 编辑区 : 预览区
  defaultMode: 'split',       // 新打开文档的默认显示模式：'split'(阅读和编辑) | 'read'(阅读) | 'edit'(编辑)
  signatureEnabled: true,     // 是否在预览末尾显示落款
  signatureName: '许帆',       // 落款署名
  signatureEmail: 'cfanx@163.com', // 落款邮箱
  showFileTree: true,
  showToc: true,
  treeSortBy: 'name',         // 'name' | 'mtime'
  lastDir: '',
  recentFiles: [],            // [{ path, name, time }]
  window: { width: 1360, height: 860, x: undefined, y: undefined, maximized: false },
};

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed, window: { ...DEFAULTS.window, ...(parsed.window || {}) } };
    } catch {
      return { ...DEFAULTS, recentFiles: [], window: { ...DEFAULTS.window } };
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[settings] 保存失败:', e.message);
    }
  }

  get() { return this.data; }

  set(patch) {
    const { window, ...rest } = patch || {};
    Object.assign(this.data, rest);
    if (window) Object.assign(this.data.window, window);
    this._save();
    return this.data;
  }

  addRecent(filePath, name) {
    const list = (this.data.recentFiles || []).filter((r) => r.path !== filePath);
    list.unshift({ path: filePath, name: name || require('path').basename(filePath), time: Date.now() });
    this.data.recentFiles = list.slice(0, 10);
    this._save();
    return this.data.recentFiles;
  }

  clearRecent() {
    this.data.recentFiles = [];
    this._save();
    return [];
  }

  saveWindow(bounds) {
    this.data.window = { ...this.data.window, ...bounds };
    this._save();
  }
}

module.exports = { SettingsStore, DEFAULTS };
