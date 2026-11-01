/* MarkFlow - 目录多文件搜索（S2） */
import { debounce, escapeHtml } from './utils.js';
import { t } from './i18n.js';

export function createDirSearch(panelEl, { getDir, onOpenFileAtLine }) {
  let dir = '';
  let panelBuilt = false;

  function buildPanel() {
    panelEl.innerHTML = `
      <div class="search-header">
        <input type="text" class="search-input" data-i18n-ph="search.placeholder" placeholder="${escapeHtml(t('search.placeholder'))}">
        <div class="search-opts">
          <label><input type="checkbox" class="opt-case"> ${escapeHtml(t('search.case'))}</label>
          <label><input type="checkbox" class="opt-name" checked> ${escapeHtml(t('search.name'))}</label>
          <label><input type="checkbox" class="opt-content" checked> ${escapeHtml(t('search.content'))}</label>
        </div>
        <button class="search-close" title="关闭">×</button>
      </div>
      <div class="search-result"></div>`;
    const input = panelEl.querySelector('.search-input');
    const result = panelEl.querySelector('.search-result');
    const optCase = panelEl.querySelector('.opt-case');
    const optName = panelEl.querySelector('.opt-name');
    const optContent = panelEl.querySelector('.opt-content');
    panelEl.querySelector('.search-close').addEventListener('click', close);

    const doSearch = debounce(async () => {
      const q = input.value.trim();
      if (!q) { result.innerHTML = ''; return; }
      try {
        const res = await window.api.searchDir(dir, q, {
          caseSensitive: optCase.checked,
          name: optName.checked,
          content: optContent.checked,
        });
        renderResult(result, res, q);
      } catch (e) {
        result.innerHTML = `<div class="search-empty">${escapeHtml(e.message)}</div>`;
      }
    }, 300);

    input.addEventListener('input', doSearch);
    [optCase, optName, optContent].forEach((c) => c.addEventListener('change', doSearch));
    panelBuilt = true;
  }

  function renderResult(result, res, q) {
    if (!res.ok) { result.innerHTML = `<div class="search-empty">${escapeHtml(res.error)}</div>`; return; }
    if (!res.files.length) { result.innerHTML = `<div class="search-empty">${escapeHtml(t('search.empty'))}</div>`; return; }
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="search-summary">${escapeHtml(t('search.results', { n: res.total }))}</div>`;
    for (const f of res.files) {
      const group = document.createElement('div');
      group.className = 'search-file';
      group.innerHTML = `<div class="search-file-name">${escapeHtml(f.name)}</div>`;
      for (const m of f.matches) {
        const line = document.createElement('div');
        line.className = 'search-match';
        line.innerHTML = `<span class="search-line">${m.line}:${m.col}</span> <span class="search-text">${escapeHtml(m.text)}</span>`;
        line.addEventListener('click', () => onOpenFileAtLine(f.file, m.line, m.col));
        group.appendChild(line);
      }
      wrap.appendChild(group);
    }
    result.innerHTML = '';
    result.appendChild(wrap);
  }

  function open() {
    dir = getDir();
    if (!dir) return false;
    if (!panelBuilt) buildPanel();
    panelEl.hidden = false;
    const input = panelEl.querySelector('.search-input');
    input.value = '';
    panelEl.querySelector('.search-result').innerHTML = '';
    input.focus();
    return true;
  }
  function close() { panelEl.hidden = true; }
  function toggle() { if (panelEl.hidden) return open(); close(); return false; }

  return { open, close, toggle };
}
