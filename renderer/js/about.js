/* MarkFlow - 「关于」对话框（应用信息 + 署名设置） */
import { t } from './i18n.js';
import { debounce } from './utils.js';

/**
 * 关于对话框：
 *   - 应用信息（版本、技术栈）
 *   - 署名设置（显示落款 / 署名 / 邮箱）
 * 署名设置原在设置面板，现按需求迁移至此。
 */
export function createAbout(modalEl, { getSettings, onChange }) {
  function current() { return typeof getSettings === 'function' ? getSettings() : getSettings; }

  function build() {
    const s = current();
    modalEl.innerHTML = `
      <div class="modal-card about-card">
        <div class="modal-title">${escapeHtml(t('about.title'))}</div>
        <div class="about-head">
          <div class="about-logo">M</div>
          <div class="about-meta">
            <div class="about-name">MarkFlow</div>
            <div class="about-ver">${escapeHtml(t('about.version', { ver: '…' }))}</div>
          </div>
        </div>
        <div class="about-desc">${escapeHtml(t('about.desc'))}</div>

        <div class="set-section">${escapeHtml(t('set.signature'))}</div>
        <div class="settings-grid">
          <label class="set-row"><span>${escapeHtml(t('set.signatureShow'))}</span>
            <input type="checkbox" data-k="signatureEnabled"></label>
          <label class="set-row"><span>${escapeHtml(t('set.signatureName'))}</span>
            <input type="text" data-k="signatureName" placeholder="${escapeHtml(t('set.signatureNamePh'))}"></label>
          <label class="set-row"><span>${escapeHtml(t('set.signatureEmail'))}</span>
            <input type="email" data-k="signatureEmail" placeholder="${escapeHtml(t('set.signatureEmailPh'))}"></label>
          <div class="set-hint">${escapeHtml(t('set.signatureHint'))}</div>
        </div>

        <div class="modal-actions">
          <button class="btn primary" data-act="close">${escapeHtml(t('set.close'))}</button>
        </div>
      </div>`;

    // 填充当前值
    modalEl.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      const val = s[k];
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val == null ? '' : val;
      el.addEventListener('change', () => {
        const v = el.type === 'checkbox' ? el.checked : el.value;
        applyPatch({ [k]: v });
      });
      // 文本/邮箱：输入即生效（防抖），落款实时预览
      if (el.type === 'text' || el.type === 'email') {
        el.addEventListener('input', debounce(() => applyPatch({ [k]: el.value }), 250));
      }
    });

    modalEl.querySelector('[data-act="close"]').onclick = close;

    // 异步填版本号
    window.api.getVersion().then((v) => {
      const el = modalEl.querySelector('.about-ver');
      if (el) el.textContent = t('about.version', { ver: v });
    }).catch(() => {});
  }

  function applyPatch(patch) {
    const s = current();
    Object.assign(s, patch);
    onChange(patch);
  }

  function open() {
    build();
    modalEl.hidden = false;
    const mask = document.getElementById('about-mask');
    mask.hidden = false;
    mask.onclick = (e) => { if (e.target === mask) close(); };
  }
  function close() {
    modalEl.hidden = true;
    document.getElementById('about-mask').hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { open, close };
}
