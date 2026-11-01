/* MarkFlow - 设置面板（U2 / 主题 / 字体 / 自动保存 / 文件关联） */
import { t, setLang } from './i18n.js';
import { toast, debounce } from './utils.js';

const FONT_BODY = {
  system: "'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  yahei: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  simsun: "'SimSun', '宋体', serif",
  dengxian: "'DengXian', '等线', 'Microsoft YaHei', sans-serif",
};
const FONT_CODE = {
  consolas: "Consolas, 'Cascadia Code', 'Courier New', monospace",
  cascadia: "'Cascadia Code', Consolas, monospace",
  jetbrains: "'JetBrains Mono', Consolas, monospace",
  menlo: "'Menlo', Consolas, monospace",
};

export const FONT_MAPS = { FONT_BODY, FONT_CODE };

export function createSettings(modalEl, { getSettings, onChange, onAbout }) {
  /* getSettings 可以是对象或函数；函数形式每次取最新值，避免 state 替换后引用失效 */
  function current() { return typeof getSettings === 'function' ? getSettings() : getSettings; }

  function build() {
    const settings = current();
    modalEl.innerHTML = `
      <div class="modal-card settings-card">
        <div class="modal-title">${escapeHtml(t('set.title'))}</div>
        <div class="settings-grid">
          <label class="set-row"><span>${escapeHtml(t('set.theme'))}</span>
            <select data-k="theme">
              <option value="system">${escapeHtml(t('set.themeSys'))}</option>
              <option value="light">${escapeHtml(t('set.themeLight'))}</option>
              <option value="dark">${escapeHtml(t('set.themeDark'))}</option>
            </select></label>
          <label class="set-row"><span>${escapeHtml(t('set.language'))}</span>
            <select data-k="language">
              <option value="zh-CN">${escapeHtml(t('set.zh'))}</option>
              <option value="en">${escapeHtml(t('set.en'))}</option>
            </select></label>
          <label class="set-row"><span>${escapeHtml(t('set.font'))}</span>
            <select data-k="fontFamily">
              ${Object.keys(FONT_BODY).map((k) => `<option value="${k}">${k}</option>`).join('')}
            </select></label>
          <label class="set-row"><span>${escapeHtml(t('set.codeFont'))}</span>
            <select data-k="codeFontFamily">
              ${Object.keys(FONT_CODE).map((k) => `<option value="${k}">${k}</option>`).join('')}
            </select></label>
          <label class="set-row"><span>${escapeHtml(t('set.fontSize'))}</span>
            <input type="range" data-k="fontSize" min="12" max="24" step="1"></label>
          <label class="set-row"><span>${escapeHtml(t('set.defaultMode'))}</span>
            <select data-k="defaultMode" title="${escapeHtml(t('set.defaultModeHint'))}">
              <option value="split">${escapeHtml(t('set.modeSplit'))}</option>
              <option value="read">${escapeHtml(t('set.modeRead'))}</option>
              <option value="edit">${escapeHtml(t('set.modeEdit'))}</option>
            </select></label>
          <div class="set-hint">${escapeHtml(t('set.defaultModeHint'))}</div>
          <label class="set-row"><span>${escapeHtml(t('set.autosave'))}</span>
            <input type="checkbox" data-k="autosave"></label>
          <label class="set-row"><span>${escapeHtml(t('set.autosaveInterval'))}</span>
            <input type="number" data-k="autosaveInterval" min="5" max="600" step="5" style="width:80px"></label>
          <label class="set-row"><span>${escapeHtml(t('set.showTree'))}</span>
            <input type="checkbox" data-k="showFileTree"></label>
          <label class="set-row"><span>${escapeHtml(t('set.showToc'))}</span>
            <input type="checkbox" data-k="showToc"></label>
        </div>
        <div class="settings-actions">
          <button class="btn ghost" data-act="register">${escapeHtml(t('set.register'))}</button>
          <button class="btn ghost" data-act="unregister">${escapeHtml(t('set.unregister'))}</button>
          <button class="btn ghost" data-act="clearRecent">${escapeHtml(t('set.clearRecent'))}</button>
          <button class="btn ghost" data-act="about">${escapeHtml(t('set.about'))}</button>
          <span class="spacer"></span>
          <button class="btn primary" data-act="close">${escapeHtml(t('set.close'))}</button>
        </div>
      </div>`;

    // 填充当前值
    modalEl.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      const val = settings[k];
      if (el.type === 'checkbox') el.checked = !!val;
      else if (el.type === 'range' || el.type === 'number') el.value = val;
      else el.value = val == null ? '' : val;
      el.addEventListener('change', () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'range' || el.type === 'number') v = Number(el.value);
        else v = el.value;
        applyPatch({ [k]: v });
      });
      // 文本/邮箱类：输入时即时生效（防抖），落款预览可实时更新
      if (el.type === 'text' || el.type === 'email' || el.type === 'password') {
        const live = debounce(() => applyPatch({ [k]: el.value }), 250);
        el.addEventListener('input', live);
      }
    });

    modalEl.querySelector('[data-act="close"]').onclick = close;
    modalEl.querySelector('[data-act="register"]').onclick = async () => {
      const r = await window.api.registerFileAssoc();
      toast(r && r.ok ? t('msg.assocOn') : (r && r.error || '失败'));
    };
    modalEl.querySelector('[data-act="unregister"]').onclick = async () => {
      const r = await window.api.unregisterFileAssoc();
      toast(r && r.ok ? t('msg.assocOff') : (r && r.error || '失败'));
    };
    modalEl.querySelector('[data-act="clearRecent"]').onclick = async () => {
      await window.api.clearRecent();
      toast('已清除');
    };
    modalEl.querySelector('[data-act="about"]').onclick = () => {
      // 「关于」使用独立对话框，需先关掉设置面板
      close();
      if (onAbout) onAbout();
    };
  }

  function applyPatch(patch) {
    const settings = current();
    Object.assign(settings, patch);
    if (patch.language) setLang(patch.language);
    onChange(patch);
  }

  function open() {
    build();
    modalEl.hidden = false;
    const mask = document.getElementById('modal-mask');
    mask.hidden = false;
    mask.onclick = (e) => { if (e.target === mask) close(); };
  }
  function close() {
    modalEl.hidden = true;
    document.getElementById('modal-mask').hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { open, close };
}
