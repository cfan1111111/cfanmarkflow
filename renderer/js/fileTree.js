/* MarkFlow - 文件树侧栏（懒加载版）
 * 目录只在展开时按需拉取一层，避免大目录全量遍历与超量 DOM；
 * 展开状态与节点缓存在会话内保留，刷新文件树不重置用户操作。
 *
 * 本次修复：
 *  1) 同一层有多个已展开目录时，展开加载不再互相取消
 *     —— 改用「按刷新的 generation 令牌」取代原先全局自增的 renderToken，
 *        同一次刷新内的多个 loadInto 共享同一 gen，不会被彼此取消。
 *  2) 打开 / 选中文件时自动展开其所在目录（revealPath），保证文件列表始终可见，
 *     连续挑选多个文件无需反复展开，解决「点文件后目录树收起、只剩目录列表」的痛点。 */
import { basename, dirname } from './utils.js';

export function createFileTree(container, { onOpen, onContext, onDirChanged }) {
  let dir = '';
  let sortBy = 'name';
  let activePath = '';
  const expanded = new Set();      // 已展开的目录路径（刷新后保持）
  const cache = new Map();         // dir -> nodes（避免重复 IPC）
  let refreshGen = 0;              // 每次刷新自增；loadInto 仅当被更新的刷新取代时才取消
  let revealInFlight = false;      // 防止 reveal 重入

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

  function findDirRow(p) {
    return Array.from(container.querySelectorAll('.tree-item.dir')).find((x) => x.dataset.path === p) || null;
  }

  function renderNodes(nodes, depth, gen) {
    const frag = document.createDocumentFragment();
    for (const n of nodes) {
      const row = document.createElement('div');
      row.className = 'tree-item' + (n.isDir ? ' dir' : ' file');
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.dataset.path = n.path;
      row.dataset.depth = depth;
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
        if (isOpen) loadInto(childWrap, n.path, depth + 1, gen);
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
            loadInto(childWrap, n.path, depth + 1, refreshGen);
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

  /** 异步拉取子节点并渲染进 childWrap；带 generation 令牌，过期结果丢弃 */
  async function loadInto(childWrap, target, depth, gen) {
    let nodes;
    try {
      nodes = await fetchNodes(target);
    } catch (e) {
      if (gen === refreshGen) childWrap.innerHTML = `<div class="tree-empty">加载失败：${escapeHtml(e.message)}</div>`;
      return;
    }
    // 仅当被更新的刷新取代或容器已脱离文档时才放弃；同一次刷新内的多目录不会互相取消
    if (gen !== refreshGen || !childWrap.isConnected) return;
    childWrap.innerHTML = '';
    if (!nodes.length) {
      childWrap.innerHTML = '<div class="tree-empty">空</div>';
      return;
    }
    childWrap.appendChild(renderNodes(nodes, depth, gen));
    if (activePath) setActive(activePath);
  }

  async function refresh() {
    if (!dir) { container.innerHTML = '<div class="tree-empty">未选择目录</div>'; return; }
    const gen = ++refreshGen;
    cache.clear(); // 强制重新拉取，保证外部变更可见；已展开目录由 renderNodes 自动重载
    try {
      const nodes = await fetchNodes(dir);
      if (gen !== refreshGen) return;
      container.innerHTML = '';
      if (!nodes.length) container.innerHTML = '<div class="tree-empty">无 Markdown 文件</div>';
      else container.appendChild(renderNodes(nodes, 0, gen));
      if (onDirChanged) onDirChanged(dir);
    } catch (e) {
      if (gen !== refreshGen) return;
      container.innerHTML = `<div class="tree-empty">加载失败：${escapeHtml(e.message)}</div>`;
    }
  }

  /* 自动展开到 filePath 所在的目录，使其文件列表可见（不折叠任何其它已展开目录） */
  function revealPath(filePath) {
    if (!filePath || !dir || revealInFlight) return;
    revealInFlight = true;
    _revealPath(filePath).finally(() => { revealInFlight = false; });
  }
  async function _revealPath(filePath) {
    const targetDir = dirname(filePath);
    if (targetDir === dir) return; // 文件就在工作目录根层，无需展开
    if (!(targetDir.startsWith(dir + '\\') || targetDir.startsWith(dir + '/'))) return;
    // 收集从目标目录回溯到工作目录的各层祖先（深→浅）
    const ancestors = [];
    let cur = targetDir;
    while (cur.length > dir.length) {
      ancestors.push(cur);
      const parent = dirname(cur);
      if (parent === dir || parent.length <= dir.length) break;
      cur = parent;
    }
    ancestors.reverse(); // 改为浅→深，逐级展开
    for (const a of ancestors) {
      if (expanded.has(a)) continue;
      const row = findDirRow(a);
      if (!row) break; // 上层尚未渲染出这一级，停止（正常不会发生，因为浅层先加载）
      expanded.add(a);
      const twisty = row.querySelector('.twisty');
      twisty.textContent = '▾';
      twisty.classList.add('expanded');
      const childWrap = row.nextElementSibling;
      if (childWrap && childWrap.classList.contains('tree-children')) {
        childWrap.style.display = '';
        const depth = (parseInt(row.dataset.depth, 10) || 0) + 1;
        await loadInto(childWrap, a, depth, refreshGen);
      }
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
      if (p) revealPath(p); // 自动展开到该文件所在目录，保证文件列表可见
    },
  };
}
