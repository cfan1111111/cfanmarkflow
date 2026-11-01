/* MarkFlow - 文件树侧栏（F2，懒加载版）
 * 目录只在展开时按需拉取一层，避免大目录全量遍历与超量 DOM；
 * 展开状态与节点缓存在会话内保留，刷新文件树不重置用户操作。 */
import { basename } from './utils.js';

export function createFileTree(container, { onOpen, onContext, onDirChanged }) {
  let dir = '';
  let sortBy = 'name';
  let activePath = '';
  const expanded = new Set();      // 已展开的目录路径（刷新后保持）
  const cache = new Map();         // dir -> nodes（避免重复 IPC）
  let renderToken = 0;             // 防止异步渲染竞态覆盖新结果

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function fetchNodes(target) {
    if (cache.has(target)) return cache.get(target);
    const res = await window.api.listChildren(target, sortBy);
    if (!res.ok) throw new Error(res.error);
    cache.set(target, res.nodes || []);
    return res.nodes || [];
  }

  function renderNodes(nodes, depth) {
    const frag = document.createDocumentFragment();
    for (const n of nodes) {
      const row = document.createElement('div');
      row.className = 'tree-item' + (n.isDir ? ' dir' : ' file');
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.dataset.path = n.path;
      if (!n.isDir && n.path === activePath) row.classList.add('active');

      if (n.isDir) {
        row.innerHTML = `<span class="twisty">▸</span><span class="ico">📁</span><span class="name">${escapeHtml(n.name)}</span>`;
        const childWrap = document.createElement('div');
        childWrap.className = 'tree-children';
        childWrap.style.display = 'none';
        childWrap.innerHTML = '<div class="tree-empty">加载中…</div>';
        const isOpen = expanded.has(n.path);
        const twisty = row.querySelector('.twisty');
        twisty.textContent = isOpen ? '▾' : '▸';
        twisty.classList.toggle('expanded', isOpen);
        frag.appendChild(row);
        frag.appendChild(childWrap);
        if (isOpen) loadInto(childWrap, n.path, depth + 1);
        row.addEventListener('click', () => {
          if (expanded.has(n.path)) {
            expanded.delete(n.path);
            twisty.textContent = '▸';
            twisty.classList.remove('expanded');
            childWrap.style.display = 'none';
          } else {
            expanded.add(n.path);
            twisty.textContent = '▾';
            twisty.classList.add('expanded');
            childWrap.style.display = '';
            loadInto(childWrap, n.path, depth + 1);
          }
        });
      } else {
        row.innerHTML = `<span class="twisty"></span><span class="ico">📄</span><span class="name">${escapeHtml(n.name)}</span>`;
        row.addEventListener('click', () => onOpen(n.path));
        frag.appendChild(row);
      }
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onContext(n.path, e.clientX, e.clientY);
      });
    }
    return frag;
  }

  /** 异步拉取子节点并渲染进 childWrap；带竞态令牌，过期结果丢弃 */
  async function loadInto(childWrap, target, depth) {
    const token = ++renderToken;
    let nodes;
    try {
      nodes = await fetchNodes(target);
    } catch (e) {
      if (token === renderToken) childWrap.innerHTML = `<div class="tree-empty">加载失败：${escapeHtml(e.message)}</div>`;
      return;
    }
    if (token !== renderToken || !childWrap.isConnected) return;
    childWrap.innerHTML = '';
    if (!nodes.length) {
      childWrap.innerHTML = '<div class="tree-empty">空</div>';
      return;
    }
    childWrap.appendChild(renderNodes(nodes, depth));
    if (activePath) setActive(activePath);
  }

  async function refresh() {
    if (!dir) { container.innerHTML = '<div class="tree-empty">未选择目录</div>'; return; }
    const token = ++renderToken;
    cache.clear(); // 强制重新拉取，保证外部变更可见；已展开目录由 renderNodes 自动重载
    try {
      const nodes = await fetchNodes(dir);
      if (token !== renderToken) return;
      container.innerHTML = '';
      if (!nodes.length) container.innerHTML = '<div class="tree-empty">无 Markdown 文件</div>';
      else container.appendChild(renderNodes(nodes, 0));
      if (onDirChanged) onDirChanged(dir);
    } catch (e) {
      if (token !== renderToken) return;
      container.innerHTML = `<div class="tree-empty">加载失败：${escapeHtml(e.message)}</div>`;
    }
  }

  return {
    setDir(d, sort) {
      dir = d;
      if (sort) sortBy = sort;
      cache.clear();
      expanded.clear();
      return refresh();
    },
    refresh,
    setSort(sort) {
      sortBy = sort || 'name';
      cache.clear();
      return refresh();
    },
    setActive(p) {
      activePath = p;
      container.querySelectorAll('.tree-item.file.active').forEach((el) => el.classList.remove('active'));
      if (p) {
        // 用 dataset 直接比对，避免路径含反斜杠等字符时选择器转义出错
        const el = Array.from(container.querySelectorAll('.tree-item.file')).find((x) => x.dataset.path === p);
        if (el) {
          el.classList.add('active');
          el.scrollIntoView({ block: 'nearest' });
        }
      }
    },
  };
}
