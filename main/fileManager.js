/**
 * MarkFlow - 文件管理：读取（含 BOM/编码探测）、原子写入、目录树、目录搜索。
 * 所有写操作均为「临时文件 + 重命名」的原子替换，异常中断不损坏原文件（N4）。
 */
const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.workbuddy', 'dist', 'out', '$RECYCLE.BIN', 'System Volume Information']);
const MD_EXTS = ['.md', '.markdown'];

/* 搜索保护上限：避免大目录全量同步读取拖死主进程 */
const SEARCH_MAX_FILE_SIZE = 1024 * 1024;   // 单文件 1MB 以上跳过内容匹配
const SEARCH_MAX_FILES = 3000;              // 最多扫描 3000 个文件
const SEARCH_MAX_TOTAL = 200;               // 最多返回 200 条文件结果

function isMarkdown(filePath) {
  return MD_EXTS.includes(path.extname(filePath).toLowerCase());
}

/** 编码识别：BOM → 严格 UTF-8 → GBK（中文 Windows 常见）→ latin1 兜底 */
function decodeBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { content: buf.slice(3).toString('utf-8'), encoding: 'utf-8', bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { content: buf.slice(2).toString('utf-16le'), encoding: 'utf-16le', bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { content: buf.slice(2).toString('utf-16be'), encoding: 'utf-16be', bom: true };
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8', bom: false };
  } catch { /* 非严格 UTF-8，继续尝试其他编码 */ }
  try {
    return { content: new TextDecoder('gbk', { fatal: true }).decode(buf), encoding: 'gbk', bom: false };
  } catch { /* 环境不支持 GBK 解码或序列非法，走 latin1 兜底 */ }
  return { content: buf.toString('latin1'), encoding: 'latin1', bom: false };
}

/** 内容编码：支持 utf-8 / utf-16le / utf-16be；GBK 文件统一升级为 UTF-8（带 BOM）后返回 converted 标记 */
function encodeContent(content, encoding, bom) {
  if (encoding === 'utf-16le') {
    const body = Buffer.from(content, 'utf-16le');
    return bom ? Buffer.concat([Buffer.from('\uFEFF', 'utf16le'), body]) : body;
  }
  if (encoding === 'utf-16be') {
    const body = Buffer.from(content, 'utf16le').swap16();
    return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), body]) : body;
  }
  /* utf-8 / gbk / latin1 及其它：按 UTF-8 写回；GBK 升级时附加 BOM 以保持兼容 */
  const body = Buffer.from(content, 'utf-8');
  return bom || encoding === 'gbk' || encoding === 'latin1'
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
    : body;
}

/** 读取文件：返回 content / encoding / bom / mtime / size */
function readFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const { content, encoding, bom } = decodeBuffer(buf);
  const stat = fs.statSync(filePath);
  return { content, encoding, bom, mtime: stat.mtimeMs, size: stat.size };
}

/** 原子写入：同目录临时文件 → rename 覆盖（N4） */
function writeFileAtomic(filePath, content, bom, encoding = 'utf-8') {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.mftmp-${process.pid}-${Date.now()}`);
  const data = encodeContent(content, encoding, !!bom);
  const converted = (encoding === 'gbk' || encoding === 'latin1') ? 'utf-8' : encoding;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  return { mtime: fs.statSync(filePath).mtimeMs, size: data.length, converted };
}

/** 懒加载列表：只返回一层节点；目录统一标记可展开，点击展开时再按需拉取 */
function listChildren(dir, sortBy) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORED_DIRS.has(ent.name)) continue;
      let stat = null;
      try { stat = fs.statSync(full); } catch { /* 忽略 */ }
      nodes.push({ name: ent.name, path: full, isDir: true, mtime: stat ? stat.mtimeMs : 0, children: null });
    } else if (ent.isFile() && isMarkdown(full)) {
      let stat = null;
      try { stat = fs.statSync(full); } catch { /* 忽略 */ }
      nodes.push({ name: ent.name, path: full, isDir: false, mtime: stat ? stat.mtimeMs : 0, size: stat ? stat.size : 0 });
    }
  }
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sortBy === 'mtime') return b.mtime - a.mtime;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return nodes;
}

/** 兼容旧接口：全量递归树（测试与调试用；常规浏览请使用 listChildren 懒加载） */
function listDir(dir, sortBy) {
  const walk = (current, depth) => {
    const nodes = listChildren(current, sortBy).map((n) => ({ ...n, children: n.isDir ? null : undefined }));
    for (const n of nodes) {
      if (n.isDir && depth < 8) n.children = walk(n.path, depth + 1);
    }
    return nodes;
  };
  return walk(dir, 0);
}

/** 目录多文件搜索：文件名 + 内容（S2），带上限保护 */
function searchDir(dir, query, opts) {
  const { caseSensitive = false, content = true, name = true } = opts || {};
  if (!query) return { files: [], total: 0, truncated: false };
  const q = caseSensitive ? query : query.toLowerCase();
  const results = [];
  let scanned = 0;
  let truncated = false;
  const walk = (current) => {
    if (truncated) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        walk(full);
      } else if (ent.isFile() && isMarkdown(full)) {
        if (scanned >= SEARCH_MAX_FILES || results.length >= SEARCH_MAX_TOTAL) { truncated = true; return; }
        scanned++;
        const nameHit = name && (caseSensitive ? ent.name : ent.name.toLowerCase()).includes(q);
        const matches = [];
        if (content) {
          let text;
          try {
            if (fs.statSync(full).size > SEARCH_MAX_FILE_SIZE) continue;
            text = fs.readFileSync(full, 'utf-8');
          } catch { continue; }
          const lines = text.split(/\r\n|\r|\n/);
          for (let i = 0; i < lines.length && matches.length < 50; i++) {
            const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
            const col = hay.indexOf(q);
            if (col !== -1) matches.push({ line: i + 1, col: col + 1, text: lines[i].trim().slice(0, 200) });
          }
        }
        if (nameHit || matches.length) {
          results.push({ file: full, name: ent.name, nameHit: !!nameHit, matches });
        }
      }
    }
  };
  walk(dir);
  const total = results.reduce((s, r) => s + r.matches.length, 0);
  return { files: results, total, truncated };
}

module.exports = { readFile, writeFileAtomic, listDir, listChildren, searchDir, isMarkdown, MD_EXTS };
