/* MarkFlow - 通用工具 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, wait);
  };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * CSS 选择器转义。
 * 必须能处理以数字开头或含中文的 slug（如标题“1. 基础排版” → `1-基础排版`），
 * 否则 querySelector('#1-基础排版') 会抛 SyntaxError。
 * 优先用原生 CSS.escape，缺失时用等价的手写实现兜底。
 */
export function cssEscape(s) {
  const str = String(s);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    try { return CSS.escape(str); } catch { /* 落到兜底实现 */ }
  }
  // 兜底：逐字符转义，数字开头补转义序列，保留 - _ 字母数字
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (code === 0) { out += '\uFFFD'; continue; }
    if ((code >= 1 && code <= 31) || code === 127 || (i === 0 && code >= 48 && code <= 57)) {
      out += '\\' + code.toString(16) + ' ';
      continue;
    }
    if (i === 0 && code === 45 && str.length === 1) { out += '\\-'; continue; }
    if (code >= 128 || code === 45 || code === 95 ||
        (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      out += ch;
      continue;
    }
    out += '\\' + ch;
  }
  return out;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function basename(p) {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

export function dirname(p) {
  return p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
}

export function countWords(text) {
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const words = (text.replace(/[一-鿿぀-ヿ가-힯]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  return cjk + words;
}

export function uid() {
  return 'id-' + Math.random().toString(36).slice(2, 10);
}

/** 简单确认对话框，返回 Promise<boolean> */
export function confirmDialog(message, { okText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const mask = document.getElementById('modal-mask');
    const box = document.getElementById('modal');
    box.innerHTML = `
      <div class="modal-card">
        <div class="modal-body">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button class="btn ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    mask.hidden = false;
    const close = (r) => { mask.hidden = true; box.innerHTML = ''; resolve(r); };
    box.querySelector('[data-act="ok"]').onclick = () => close(true);
    box.querySelector('[data-act="cancel"]').onclick = () => close(false);
    mask.onclick = (e) => { if (e.target === mask) close(false); };
  });
}

let toastTimer = null;
export function toast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
}
