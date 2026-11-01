/* MarkFlow - 预览渲染（markdown-it + GFM + 代码高亮 + 任务列表回写 + TOC） */
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/common';
import { escapeHtml, escapeAttr, dirname, basename } from './utils.js';
import { t } from './i18n.js';

const md = new MarkdownIt({
  html: false,
  xhtmlOut: false,
  breaks: false,
  linkify: true,
  typographer: false,
});
md.use(footnote);

/* ---------- 任务列表：渲染复选框并标注源行（支持回写，P4） ---------- */
md.core.ruler.push('mdflow_tasklist', (state) => {
  const tokens = state.tokens;
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'list_item_open') stack.push(tk);
    else if (tk.type === 'list_item_close') stack.pop();
    else if (tk.type === 'inline' && tk.children && tk.children.length) {
      const first = tk.children[0];
      if (first && (first.type === 'text') && first.content) {
        const m = /^\[([ xX])\]\s/.exec(first.content);
        if (m) {
          const checked = m[1] !== ' ';
          const line = (tk.map ? tk.map[0] : 0) + 1;
          const item = stack[stack.length - 1];
          if (item) {
            const cls = (item.attrGet('class') || '') + ' task-item';
            item.attrSet('class', cls.trim());
            item.attrSet('data-line', String(line));
          }
          const cb = new MarkdownIt.Token('html_inline', '', 0);
          cb.content = `<input type="checkbox" class="task-checkbox" data-line="${line}" ${checked ? 'checked' : ''}>`;
          first.content = first.content.slice(m[0].length);
          tk.children.unshift(cb);
        }
      }
    }
  }
  return true;
});

/* ---------- 标题锚点（TOC 用） ---------- */
function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildTocAndIds(tokens) {
  const used = {};
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'heading_open') {
      const inline = tokens[i + 1];
      const text = inline && inline.content ? inline.content : '';
      let slug = slugify(text) || 'section';
      if (used[slug] != null) { used[slug] += 1; slug = `${slug}-${used[slug]}`; }
      else used[slug] = 0;
      tk.attrSet('id', slug);
      // line：标题在源文本中的行号（1-based），供编辑模式下跳转定位
      const line = tk.map ? tk.map[0] + 1 : null;
      toc.push({ level: Number(tk.tag.slice(1)) || 1, text, slug, line });
    }
  }
  return toc;
}

/* ---------- 代码块：高亮 + 行号 + 复制按钮（P3） ---------- */
function highlightCode(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const code = token.content;
  const lang = (token.info || '').trim().split(/\s+/)[0] || '';
  const highlighted = highlightCode(code, lang);
  const lineCount = code.split('\n').length;
  const gutter = Array.from({ length: lineCount }, (_, i) => `<span class="ln">${i + 1}</span>`).join('');
  const langLabel = lang ? lang.toUpperCase() : 'TEXT';
  return `<div class="code-block" data-lang="${escapeAttr(lang)}"><div class="code-head"><span class="code-lang">${escapeHtml(langLabel)}</span><button type="button" class="code-copy" title="${escapeAttr(t('tb.copy'))}">${escapeHtml(t('tb.copy'))}</button></div><div class="code-body"><div class="code-gutter">${gutter}</div><pre><code class="hljs language-${escapeAttr(lang)}">${highlighted}</code></pre></div></div>`;
};

/* ---------- 图片相对路径解析 + 失败占位（P5） ---------- */
function resolveFile(src, docDir) {
  try {
    const base = 'file:///' + docDir.replace(/\\/g, '/').replace(/\/?$/, '/');
    return new URL(src, base).href;
  } catch { return src; }
}

const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const si = token.attrIndex('src');
  let src = si >= 0 ? token.attrs[si][1] : '';
  if (env.docDir && src && !/^(https?:|data:|file:|#)/i.test(src)) {
    token.attrs[si][1] = resolveFile(src, env.docDir);
  }
  token.attrSet('loading', 'lazy');
  return defaultImage(tokens, idx, options, env, self);
};

/* ---------- 外部链接新窗口（P5） ---------- */
const defaultLinkOpen = md.renderer.rules.link_open || ((tks, i, o, e, s) => s.renderToken(tks, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/* ---------- 渲染入口 ---------- */
export function renderMarkdown(text, { docPath = '' } = {}) {
  const env = { docDir: docPath ? dirname(docPath) : '' };
  const tokens = md.parse(text, env);
  const toc = buildTocAndIds(tokens);
  const html = md.renderer.render(tokens, md.options, env);
  return { html, toc };
}

/**
 * 落款区块（署名 + 邮箱）。
 * 独立于 markdown 渲染，附加在预览区末尾——不进入 tab.content，因此不会写回 .md 源文件。
 * 参数键名与 settingsStore 中的设置项保持一致。
 */
export function buildSignatureHtml(settings = {}) {
  if (!settings.signatureEnabled) return '';
  const n = String(settings.signatureName || '').trim();
  const e = String(settings.signatureEmail || '').trim();
  if (!n && !e) return '';
  const parts = [];
  if (n) parts.push(`<div class="sig-name">${escapeHtml(n)}</div>`);
  if (e) parts.push(`<div class="sig-email"><a href="mailto:${escapeAttr(e)}" title="mailto:${escapeAttr(e)}">${escapeHtml(e)}</a></div>`);
  return `<div class="doc-signature" data-signature="1">${parts.join('')}</div>`;
}

/* ---------- 预览区交互（复制 / 任务回写 / 链接） ---------- */
export function initPreview(container, handlers = {}) {
  container.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.code-copy');
    if (copyBtn) {
      const code = copyBtn.closest('.code-block').querySelector('code');
      const text = code ? code.textContent : '';
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => {
        const old = copyBtn.textContent;
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = old; }, 1200);
      });
      e.preventDefault();
      return;
    }
    const cb = e.target.closest('.task-checkbox');
    if (cb && !cb.disabled) {
      const line = Number(cb.getAttribute('data-line')); // 1-indexed
      cb.disabled = true; // 防抖
      setTimeout(() => { cb.disabled = false; }, 50);
      if (handlers.onTaskToggle) handlers.onTaskToggle(line);
      e.preventDefault();
      return;
    }
    const a = e.target.closest('a');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        e.preventDefault();
        if (handlers.openExternal) handlers.openExternal(href);
      } else if (/^mailto:/i.test(href)) {
        // 落款邮箱：交给系统默认邮件客户端
        e.preventDefault();
        if (handlers.openExternal) handlers.openExternal(href);
      } else if (href.startsWith('#')) {
        e.preventDefault();
        const el = container.querySelector(`#${CSS.escape(href.slice(1))}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('toc-flash');
          setTimeout(() => el.classList.remove('toc-flash'), 900);
        }
      }
    }
  });

  // 图片加载失败 → 占位
  container.addEventListener('error', (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG') {
      const wrap = img.parentElement;
      const ph = document.createElement('div');
      ph.className = 'img-error';
      ph.textContent = `⚠ 图片加载失败：${img.getAttribute('src') || ''}`;
      img.replaceWith(ph);
    }
  }, true);
}
