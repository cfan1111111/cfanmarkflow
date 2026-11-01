/* MarkFlow - 文件树侧栏（懒加载版）
 * 目录只在展开时按需拉取一层，避免大目录全量遍历与超量 DOM；
 * 展开状态与节点缓存在会话内保留，刷新文件树不重置用户操作。
 *
 * 修复要点：
 *  1) 同一层有多个已展开目录时，展开加载不再互相取消
 *     —— 改用「按刷新的 generation 令牌」取代原先全局自增的 renderToken，
 *        同一次刷新内的多个 loadInto 共享同一 gen，不会被彼此取消。
 *  2) 打开 / 选中文件时自动展开其所在目录（revealPath），保证文件列表始终可见，
 *     连续挑选多个文件无需反复展开，解决「点文件后目录树收起、只剩目录列表」的痛点。
 *  3) 路径统一归一化（分隔符 / 大小写 / 尾部斜杠），避免 Windows 下因「打开文件」对话框、
 *     最近文件等来源的路径分隔符或大小写不一致，导致 reveal 判定失败、文件在树中“消失/像被收起”。 */
import { basename, dirname } from './utils.js';

/** 路径归一化：统一为反斜杠、去尾部分隔符、转小写（Windows 路径大小写不敏感）。 */
function normPath(p) {
  return String(p || '')
    .replace(/[\\/]+$/, '')
    .replace(/[\\/]/g, '\\')
    .toLowerCase();
}

/** 判断 child 是否位于 parent 之内（含相等）。归一化后比较，跨分隔符/大小写稳健。 */
export function isWithinDir(parent, child) {
  const a = normPath(parent);
  const b = normPath(child);
  return b === a || b.startsWith(a + '\\');
}

export function createFileTree(container, { onOpen, onContext, onDirChanged }) {
  let dir = '';
  let sortBy = 'name';
  let activePath = '';
  const expanded = new Set();      // 已展开目录（归一化 key）
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
    const k = normPath(p);
    return Array.from(container.querySelectorAll('.tree-item.dir')).find((x) => normPath(x.dataset.path) === k) || null;
  }

  function renderNodes(nodes, depth, gen) {
    const frag = document.createDocumentFragment();
    for (const n of nodes) {
      const pkey = normPath(n.path);
      const row = document.createElement('div');
      row.className = 'tree-item' + (n.isDir ? ' dir' : ' file');
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.dataset.path = pkey;
      row.dataset.depth = depth;
      if (!n.isDir && pkey === normPath(activePath)) row.classList.add('active');

      if (n.isDir) {
        row.innerHTML = `<span class="twisty">▸</span><span class="ico">📁</span><span class="name">${escapeHtml(n.name)}</span>`;
        const childWrap = document.createElement('div');
        childWrap.className = 'tree-children';
        const isOpen = expanded.has(pkey);
        // 关键：刷新时必须把「已展开目录」的子容器保持可见，否则 renderNodes 重建后
        // 子项仍为 display:none —— 外部修改触发的 refresh() 会让目录树“视觉收起”。
        childWrap.style.display = isOpen ? '' : 'none';
        const twisty = row.querySelector('.twisty');
        twisty.textContent = isOpen ? '▾' : '▸';
        twisty.classList.toggle('expanded', isOpen);
        frag.appendChild(row);
        frag.appendChild(childWrap);
        if (isOpen) loadInto(childWrap, pkey, depth + 1, gen);
        row.addEventListener('click', () => {
          if (expanded.has(pkey)) {
            expanded.delete(pkey);
            twisty.textContent = '▸';
            twisty.classList.remove('expanded');
            childWrap.style.display = 'none';
          } else {
            expanded.add(pkey);
            twisty.textContent = '▾';
            twisty.classList.add('expanded');
            childWrap.style.display = '';
            loadInto(childWrap, pkey, depth + 1, refreshGen);
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

  /* 设置当前活动文件并高亮；同时自动展开其所在目录（revealPath），保证文件列表可见。
   * 必须定义为局部函数：loadInto 末尾也要调用它（给新加载的子节点补高亮），
   * 不能只作为返回对象的方法——否则 loadInto 内裸调用会抛 “setActive is not defined”。 */
  function setActive(p) {
    activePath = p;
    const ak = normPath(p);
    container.querySelectorAll('.tree-item.file.active').forEach((el) => el.classList.remove('active'));
    if (p) {
      // 用归一化 dataset 直接比对，避免路径含反斜杠 / 大小写差异导致选择器匹配失败
      const el = Array.from(container.querySelectorAll('.tree-item.file')).find((x) => normPath(x.dataset.path) === ak);
      if (el) {
        el.classList.add('active');
        el.scrollIntoView({ block: 'nearest' });
      }
    }
    if (p) revealPath(p); // 自动展开到该文件所在目录，保证文件列表可见
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

  /* 自动展开到 filePath 所在的目录，使其文件列表可见（不折叠任何其它已展开目录）。
   * 仅处理位于「当前工作目录之内」的文件；工作目录之外的文件由 app 层切换工作目录后再 reveal。 */
  function revealPath(filePath) {
    if (!filePath || !dir || revealInFlight) return;
    revealInFlight = true;
    _revealPath(filePath).finally(() => { revealInFlight = false; });
  }
  async function _revealPath(filePath) {
    if (!filePath || !dir) return;
    const targetDir = dirname(filePath);
    const nDir = normPath(dir);
    const nTarget = normPath(targetDir);
    // 仅当文件确实位于当前工作目录之内（含根层）才在此处理；之外的交由 app 切换目录
    if (!(nTarget === nDir || nTarget.startsWith(nDir + '\\'))) return;
    if (nTarget === nDir) return; // 文件就在工作目录根层，无需展开
    // 收集从目标目录回溯到工作目录的各层祖先（深→浅）
    const ancestors = [];
    let cur = nTarget;
    while (cur.length > nDir.length) {
      ancestors.push(cur);
      const parent = normPath(dirname(cur));
      if (parent === nDir || parent.length <= nDir.length) break;
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
      dir = normPath(d);
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
    setActive,
  };
}
