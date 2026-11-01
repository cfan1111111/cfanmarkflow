/* MarkFlow - 欢迎页（无打开文件时显示） */
import { t } from './i18n.js';
import { formatTime, escapeHtml } from './utils.js';

export function createWelcome(el, { onNew, onOpen, onOpenDir, onOpenRecent }) {
  let recent = [];

  function render() {
    const recHtml = recent.length
      ? recent.map((r) => `
        <div class="recent-item" data-path="${escapeAttr(r.path)}">
          <div class="recent-name">${escapeHtml(r.name)}</div>
          <div class="recent-path">${escapeHtml(r.path)}</div>
          <div class="recent-time">${escapeHtml(formatTime(r.time))}</div>
        </div>`).join('')
      : `<div class="welcome-empty">${escapeHtml(t('welcome.noRecent'))}</div>`;

    el.innerHTML = `
      <div class="welcome-inner">
        <h1 class="welcome-title">${escapeHtml(t('welcome.title'))}</h1>
        <p class="welcome-sub">${escapeHtml(t('welcome.subtitle'))}</p>
        <div class="welcome-actions">
          <button class="btn primary" data-act="new">${escapeHtml(t('welcome.new'))}</button>
          <button class="btn" data-act="open">${escapeHtml(t('welcome.open'))}</button>
          <button class="btn" data-act="openDir">${escapeHtml(t('welcome.openDir'))}</button>
        </div>
        <div class="welcome-recent">
          <div class="welcome-recent-title">${escapeHtml(t('welcome.recent'))}</div>
          <div class="recent-list">${recHtml}</div>
        </div>
      </div>`;

    el.querySelector('[data-act="new"]').onclick = onNew;
    el.querySelector('[data-act="open"]').onclick = onOpen;
    el.querySelector('[data-act="openDir"]').onclick = onOpenDir;
    el.querySelectorAll('.recent-item').forEach((item) => {
      item.onclick = () => onOpenRecent(item.dataset.path);
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  return {
    show() { el.hidden = false; render(); },
    hide() { el.hidden = true; },
    setRecent(list) { recent = list || []; },
  };
}
