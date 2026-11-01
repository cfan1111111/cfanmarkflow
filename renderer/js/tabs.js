/* MarkFlow - 多标签页（F4） */
export function createTabs(container, { onActivate, onClose, onContext }) {
  function render(tabs, activeId) {
    container.innerHTML = '';
    for (const tab of tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.dirty ? ' dirty' : '');
      el.dataset.id = tab.id;
      el.title = tab.path || tab.name;
      el.innerHTML = `<span class="tab-name">${escapeHtml(tab.name)}</span>` +
        (tab.dirty ? '<span class="dirty-dot" title="未保存"></span>' : '') +
        '<span class="tab-close" title="关闭">×</span>';
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) return;
        onActivate(tab.id);
      });
      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        onClose(tab.id);
      });
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onContext(tab.id, e.clientX, e.clientY);
      });
      container.appendChild(el);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function setActive(activeId) {
    container.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === activeId);
    });
  }

  return { render, setActive };
}
