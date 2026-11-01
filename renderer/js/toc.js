/* MarkFlow - 目录大纲（P7 / TOC 侧栏） */
import { t } from './i18n.js';

export function createToc(container, { onJump }) {
  function render(toc) {
    container.innerHTML = '';
    if (!toc || !toc.length) {
      container.innerHTML = `<div class="toc-empty">${escapeHtml(t('toc.empty'))}</div>`;
      return;
    }
    for (const item of toc) {
      const el = document.createElement('div');
      el.className = 'toc-item';
      el.style.paddingLeft = `${(item.level - 1) * 14 + 8}px`;
      el.dataset.slug = item.slug;
      el.textContent = item.text || '(无标题)';
      el.addEventListener('click', () => onJump(item.slug));
      container.appendChild(el);
    }
  }

  function setActive(slug) {
    container.querySelectorAll('.toc-item.active').forEach((el) => el.classList.remove('active'));
    // 用 dataset 直接比对，避免 slug 含数字开头/中文时选择器转义出错
    const el = Array.from(container.querySelectorAll('.toc-item')).find((x) => x.dataset.slug === slug);
    if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { render, setActive };
}
