/* MarkFlow - 端到端验证（playwright-core 驱动 Electron） */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = __dirname.replace(/\\/g, '/').replace(/\/tests$/, '');
const ELECTRON = process.env.MF_E2E_EXE
  ? process.env.MF_E2E_EXE
  : path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const SAMPLE_DIR = path.join(ROOT, 'samples').replace(/\\/g, '/');
const SAMPLE = path.join(SAMPLE_DIR, '示例文档.md').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

/**
 * 清理残留的 MarkFlow / electron 进程。
 * 应用启用了单实例锁（requestSingleInstanceLock）：若旧进程仍在，
 * 新实例会立即 app.quit()，测试连上的是即将退出的旧实例，
 * 导致断言读到上一轮遗留的会话状态（表现为莫名其妙的 FAIL）。
 */
function killLeftovers() {
  if (process.platform !== 'win32') return;
  for (const name of ['MarkFlow.exe', 'electron.exe']) {
    try {
      execSync(`taskkill /F /IM ${name} /T`, { stdio: 'ignore' });
    } catch { /* 无残留进程时 taskkill 返回非 0，忽略 */ }
  }
}
killLeftovers();

const log = (...a) => console.log(...a);

/** 元素是否真正可见（宽高都大于 0） */
const visible = (win, sel) => win.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}, sel);

(async () => {
  log('launching', ELECTRON);
  const env = { ...process.env, MF_TEST: '1', MARKFLOW_GPU: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const win = await app.firstWindow();

  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await win.waitForSelector('#toolbar', { timeout: 20000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, '01-welcome.png') });
  log('[shot] 01 welcome');

  // 设置工作目录 + 打开示例
  await win.evaluate((d) => window.MarkFlow.setWorkingDir(d), SAMPLE_DIR);
  await win.waitForTimeout(400);
  await win.evaluate((p) => window.MarkFlow.openFile(p), SAMPLE);
  await win.waitForTimeout(900);
  await win.screenshot({ path: path.join(SHOTS, '02-split.png') });
  log('[shot] 02 split');

  const checks = [];
  const check = (name, pass, extra = '') => {
    checks.push({ name, pass });
    log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
  };

  /* ---------- 三态显示模式 ---------- */
  // 默认应为 split：源码与预览同屏
  let edVis = await visible(win, '#editor-pane');
  let pvVis = await visible(win, '#preview-pane');
  let spVis = await visible(win, '#splitter');
  check('split: 编辑器可见', edVis);
  check('split: 预览可见', pvVis);
  check('split: 分隔条可见', spVis);
  const modeAfterOpen = await win.evaluate(() => window.MarkFlow.getState().tabs.find((t) => t.path).mode);
  check('split: 标签模式为 split', modeAfterOpen === 'split', `实际=${modeAfterOpen}`);

  // 阅读模式：只有预览
  await win.evaluate(() => window.MarkFlow.setMode('read'));
  await win.waitForTimeout(350);
  edVis = await visible(win, '#editor-pane');
  pvVis = await visible(win, '#preview-pane');
  check('read: 编辑器隐藏', !edVis);
  check('read: 预览可见', pvVis);
  const roInRead = await win.evaluate(() => {
    const t = window.MarkFlow.getState().tabs.find((x) => x.path);
    return t.mode;
  });
  check('read: 标签模式为 read', roInRead === 'read', `实际=${roInRead}`);
  await win.screenshot({ path: path.join(SHOTS, '03-read.png') });
  log('[shot] 03 read');

  // 编辑模式：只有源码
  await win.evaluate(() => window.MarkFlow.setMode('edit'));
  await win.waitForTimeout(350);
  edVis = await visible(win, '#editor-pane');
  pvVis = await visible(win, '#preview-pane');
  check('edit: 编辑器可见', edVis);
  check('edit: 预览隐藏', !pvVis);
  await win.screenshot({ path: path.join(SHOTS, '04-edit.png') });
  log('[shot] 04 edit');

  // 回到 split 并输入 —— 验证同屏实时预览同步
  await win.evaluate(() => window.MarkFlow.setMode('split'));
  await win.waitForTimeout(300);
  await win.click('.cm-content');
  await win.keyboard.type('\n## 端到端测试新增标题\n这是通过自动化输入新增的内容，用于验证实时预览。');
  await win.waitForTimeout(700);
  const previewHasTyped = await win.evaluate(() => {
    const el = document.querySelector('#preview');
    return !!el && el.textContent.includes('端到端测试新增标题');
  });
  check('split: 输入实时同步到预览', previewHasTyped);
  const bothVisible = (await visible(win, '#editor-pane')) && (await visible(win, '#preview-pane'));
  check('split: 编辑与阅读同屏', bothVisible);
  await win.screenshot({ path: path.join(SHOTS, '05-split-typed.png') });
  log('[shot] 05 split typed');

  /* ---------- 回归：数字开头/中文标题的 TOC 跳转与滚动 ---------- */
  await win.evaluate(() => { document.querySelector('#preview-pane').scrollTop = 400; });
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const items = document.querySelectorAll('.toc-item');
    if (items.length) items[0].click();
  });
  await win.waitForTimeout(400);
  const selectorErrors = errors.filter((e) => /querySelector|SyntaxError|is not a valid selector/.test(e));
  check('TOC 跳转/滚动无选择器异常', selectorErrors.length === 0, selectorErrors.join(' | '));

  // 对照：旧的残缺转义实现对「数字开头的中文 slug」会抛 SyntaxError
  const escapeProbe = await win.evaluate(() => {
    const s = '1-基础排版';
    let nativeErr = null; let legacyErr = null;
    try { document.querySelector('#' + CSS.escape(s)); } catch (e) { nativeErr = e.message; }
    try { document.querySelector('#' + s.replace(/["\\]/g, '\\$&')); } catch (e) { legacyErr = e.message; }
    return { nativeErr, legacyErr };
  });
  check('CSS.escape 安全处理数字开头 slug', escapeProbe.nativeErr === null, `原生=${escapeProbe.nativeErr}`);
  check('旧实现确实会抛错（回归依据）', escapeProbe.legacyErr !== null, `旧实现=${escapeProbe.legacyErr}`);

  /* ---------- 主题 / 目录搜索 ---------- */
  await win.evaluate(() => window.MarkFlow.api.setSettings({ theme: 'dark' }));
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, '06-dark.png') });
  log('[shot] 06 dark');

  await win.evaluate(() => window.MarkFlow.api.setSettings({ theme: 'system' }));
  await win.click('#btn-search-dir');
  await win.fill('.search-input', '代码块');
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, '07-search.png') });
  log('[shot] 07 search');

  /* ---------- 断言（此时活动标签为示例文档） ---------- */
  const hasTyped = await win.evaluate(() => window.MarkFlow.getState().tabs.some((t) => t.content.includes('端到端测试新增标题')));
  const tocCount = await win.evaluate(() => document.querySelectorAll('.toc-item').length);
  const codeBlocks = await win.evaluate(() => document.querySelectorAll('.code-block').length);
  const taskBoxes = await win.evaluate(() => document.querySelectorAll('.task-checkbox').length);
  const treeItems = await win.evaluate(() => document.querySelectorAll('#file-tree .tree-item').length);

  log('--- assertions ---');
  log('toc items      :', tocCount);
  log('code blocks    :', codeBlocks);
  log('task checkboxes:', taskBoxes);
  log('tree items     :', treeItems);
  log('typed text     :', hasTyped);
  log('console errors :', errors.length ? errors : 'none');

  /* ---------- 默认打开模式设置项（走设置面板真实链路） ---------- */
  await win.click('.search-close');           // 先关掉目录搜索面板（会遮挡右上角工具栏）
  await win.waitForTimeout(300);
  await win.click('#btn-settings');
  await win.waitForTimeout(350);
  const hasModeSelect = await win.evaluate(() => !!document.querySelector('[data-k="defaultMode"]'));
  check('设置面板含“默认打开模式”项', hasModeSelect);
  await win.selectOption('[data-k="defaultMode"]', 'read');
  await win.waitForTimeout(300);
  const settingVal = await win.evaluate(() => window.MarkFlow.getState().settings.defaultMode);
  check('设置改动即时生效于 state', settingVal === 'read', `实际=${settingVal}`);
  await win.click('#modal [data-act="close"]');
  await win.waitForTimeout(250);

  await win.evaluate(() => window.MarkFlow.newFile());
  await win.waitForTimeout(450);
  const newTabMode = await win.evaluate(() => {
    const s = window.MarkFlow.getState();
    const active = s.tabs.find((t) => t.id === s.activeId);
    return active ? active.mode : null;
  });
  check('defaultMode=read：新开文档为阅读模式', newTabMode === 'read', `实际=${newTabMode}`);
  const newTabEdHidden = !(await visible(win, '#editor-pane'));
  check('defaultMode=read：新开文档不显示编辑器', newTabEdHidden);
  const newTabPvVisible = await visible(win, '#preview-pane');
  check('defaultMode=read：新开文档显示预览', newTabPvVisible);

  // 切回示例标签，恢复 split 默认
  await win.evaluate((p) => window.MarkFlow.openFile(p), SAMPLE);
  await win.waitForTimeout(400);
  const restoredMode = await win.evaluate(() => {
    const s = window.MarkFlow.getState();
    const active = s.tabs.find((t) => t.id === s.activeId);
    return active ? active.mode : null;
  });
  check('重新打开文件沿用标签自身模式', restoredMode === 'split', `实际=${restoredMode}`);
  await win.evaluate(() => window.MarkFlow.api.setSettings({ defaultMode: 'split' }));

  /* ---------- 署名（落款）设置项：已迁移到「关于」对话框 ---------- */
  // 设置面板中不应再有署名分组
  await win.click('#btn-settings');
  await win.waitForTimeout(350);
  const sigInSettings = await win.evaluate(() => !!document.querySelector('#modal [data-k="signatureName"]'));
  check('设置面板不再含署名项（已迁移）', !sigInSettings);

  // 从设置面板点「关于」→ 打开关于对话框
  await win.click('#modal [data-act="about"]');
  await win.waitForTimeout(400);
  const aboutInfo = await win.evaluate(() => ({
    maskShown: !document.getElementById('about-mask').hidden,
    hasName: !!document.querySelector('#about-modal [data-k="signatureName"]'),
    hasEmail: !!document.querySelector('#about-modal [data-k="signatureEmail"]'),
    hasEnabled: !!document.querySelector('#about-modal [data-k="signatureEnabled"]'),
    nameVal: (document.querySelector('#about-modal [data-k="signatureName"]') || {}).value,
    emailVal: (document.querySelector('#about-modal [data-k="signatureEmail"]') || {}).value,
    ver: (document.querySelector('#about-modal .about-ver') || {}).textContent || '',
    title: (document.querySelector('#about-modal .modal-title') || {}).textContent || '',
  }));
  check('「关于」对话框可打开', aboutInfo.maskShown);
  check('「关于」含署名姓名输入框', aboutInfo.hasName);
  check('「关于」含署名邮箱输入框', aboutInfo.hasEmail);
  check('「关于」含显示落款开关', aboutInfo.hasEnabled);
  check('「关于」署名默认值为“许帆”', aboutInfo.nameVal === '许帆', `实际=${aboutInfo.nameVal}`);
  check('「关于」邮箱默认值为 cfanx@163.com', aboutInfo.emailVal === 'cfanx@163.com', `实际=${aboutInfo.emailVal}`);
  check('「关于」显示版本号', /\d+\.\d+\.\d+/.test(aboutInfo.ver), `实际=${aboutInfo.ver}`);

  // 默认开启 → 预览末尾应有落款
  const sigInfo = await win.evaluate(() => {
    const pv = document.querySelector('#preview');
    const sig = pv ? pv.querySelector('.doc-signature') : null;
    if (!sig) return { exists: false };
    const name = sig.querySelector('.sig-name');
    const email = sig.querySelector('.sig-email a');
    return {
      exists: true,
      isLast: pv.lastElementChild === sig,
      name: name ? name.textContent : '',
      email: email ? email.textContent : '',
      href: email ? email.getAttribute('href') : '',
    };
  });
  check('预览末尾存在落款区块', sigInfo.exists);
  check('落款位于预览内容末尾', sigInfo.isLast);
  check('落款署名为“许帆”', sigInfo.name === '许帆', `实际=${sigInfo.name}`);
  check('落款邮箱为 cfanx@163.com', sigInfo.email === 'cfanx@163.com', `实际=${sigInfo.email}`);
  check('落款邮箱为 mailto 链接', sigInfo.href === 'mailto:cfanx@163.com', `实际=${sigInfo.href}`);

  // 关键：落款不得进入文档内容（.md 源文件不受影响）
  const contentUntouched = await win.evaluate(() => {
    const s = window.MarkFlow.getState();
    const t = s.tabs.find((x) => x.path);
    return t ? !t.content.includes('许帆') && !t.content.includes('cfanx@163.com') : false;
  });
  check('落款不写入文档内容（不改动 .md 源文件）', contentUntouched);

  // 修改署名 → 预览实时更新
  await win.fill('#about-modal [data-k="signatureName"]', '许帆（测试）');
  await win.waitForTimeout(500);
  const updatedName = await win.evaluate(() => {
    const n = document.querySelector('#preview .doc-signature .sig-name');
    return n ? n.textContent : '';
  });
  check('修改署名后预览实时更新', updatedName === '许帆（测试）', `实际=${updatedName}`);

  // 关闭开关 → 落款消失
  await win.uncheck('#about-modal [data-k="signatureEnabled"]');
  await win.waitForTimeout(500);
  const sigAfterOff = await win.evaluate(() => !!document.querySelector('#preview .doc-signature'));
  check('关闭“显示落款”后落款消失', !sigAfterOff);

  // 恢复：开启 + 原署名
  await win.check('#about-modal [data-k="signatureEnabled"]');
  await win.waitForTimeout(300);
  await win.fill('#about-modal [data-k="signatureName"]', '许帆');
  await win.waitForTimeout(500);
  const restored = await win.evaluate(() => {
    const n = document.querySelector('#preview .doc-signature .sig-name');
    const e = document.querySelector('#preview .doc-signature .sig-email a');
    return { name: n ? n.textContent : '', email: e ? e.textContent : '' };
  });
  check('落款可恢复为原署名', restored.name === '许帆' && restored.email === 'cfanx@163.com', JSON.stringify(restored));
  await win.click('#about-modal [data-act="close"]');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, '08-signature.png') });
  log('[shot] 08 signature');

  /* ---------- 编辑模式：单栏 + 目录跳转 ---------- */
  await win.evaluate(() => window.MarkFlow.setMode('edit'));
  await win.waitForTimeout(450);

  // 单栏：编辑器占满整宽（与内容区等宽），右侧不留空白栏
  const editLayout = await win.evaluate(() => {
    const ed = document.querySelector('#editor-pane');
    const pv = document.querySelector('#preview-pane');
    const panes = document.querySelector('#panes');
    const er = ed.getBoundingClientRect();
    const pr = panes.getBoundingClientRect();
    return {
      edWidth: er.width,
      edLeft: er.left,
      panesWidth: pr.width,
      panesLeft: pr.left,
      pvHidden: pv.getBoundingClientRect().width === 0,
      splitterHidden: document.querySelector('#splitter').getBoundingClientRect().width === 0,
    };
  });
  check('edit: 编辑器占满整宽', Math.abs(editLayout.edWidth - editLayout.panesWidth) < 3,
    `编辑器=${Math.round(editLayout.edWidth)}px 内容区=${Math.round(editLayout.panesWidth)}px`);
  check('edit: 编辑器左边缘与内容区对齐', Math.abs(editLayout.edLeft - editLayout.panesLeft) < 3);
  check('edit: 预览栏完全隐藏', editLayout.pvHidden);
  check('edit: 分隔条完全隐藏', editLayout.splitterHidden);

  // 目录跳转：编辑模式下点击目录应移动编辑器光标到对应标题行
  const jumpResult = await win.evaluate(async () => {
    const items = Array.from(document.querySelectorAll('.toc-item'));
    if (items.length < 2) return { skipped: true };
    const s = window.MarkFlow.getState();
    const tab = s.tabs.find((t) => t.id === s.activeId);
    const toc = tab && tab._toc ? tab._toc : null;
    const item = toc ? toc.find((x) => x.text === items[1].textContent) : null;
    return { skipped: false, text: items[1].textContent, itemLine: item ? item.line : null };
  });
  check('edit: 目录项可点击（未抛错）', !jumpResult.skipped);
  check('edit: TOC 项携带源行号', jumpResult.itemLine && jumpResult.itemLine > 1,
    `标题="${jumpResult.text}" 行号=${jumpResult.itemLine}`);

  // 校验：点击目录后光标确实落在该标题行
  const cursorAfterJump = await win.evaluate(async () => {
    const items = Array.from(document.querySelectorAll('.toc-item'));
    const target = items[items.length - 1];
    const text = target.textContent;
    target.click();
    await new Promise((r) => setTimeout(r, 350));
    const s = window.MarkFlow.getState();
    const tab = s.tabs.find((t) => t.id === s.activeId);
    const item = tab && tab._toc ? tab._toc.find((x) => x.text === text) : null;
    return {
      text,
      expectLine: item ? item.line : null,
      actualLine: window.MarkFlow.getCursorLine(),
    };
  });
  check('edit: 点目录后光标定位到该标题行',
    cursorAfterJump.expectLine && cursorAfterJump.actualLine === cursorAfterJump.expectLine,
    `期望行=${cursorAfterJump.expectLine} 实际行=${cursorAfterJump.actualLine}`);

  // TOC 高亮跟随
  const tocActive = await win.evaluate(() => {
    const a = document.querySelector('.toc-item.active');
    return a ? a.textContent : '';
  });
  check('edit: 目录高亮跟随跳转项', tocActive === cursorAfterJump.text, `高亮="${tocActive}" 目标="${cursorAfterJump.text}"`);

  await win.screenshot({ path: path.join(SHOTS, '12-edit-single-pane.png') });
  log('[shot] 12 edit single pane');
  await win.evaluate(() => window.MarkFlow.setMode('split'));
  await win.waitForTimeout(300);

  // 阅读模式下同样显示落款
  await win.evaluate(() => window.MarkFlow.setMode('read'));
  await win.waitForTimeout(400);
  const sigInRead = await win.evaluate(() => {
    const sig = document.querySelector('#preview .doc-signature');
    if (!sig) return false;
    const r = sig.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  check('阅读模式下落款同样可见', sigInRead);
  await win.evaluate(() => window.MarkFlow.setMode('split'));
  await win.waitForTimeout(300);

  /* ---------- 署名持久化（固化）：修改 → 重启 → 仍然生效 ---------- */
  // 写入一个特殊值（经 IPC 落盘到 settings.json），关闭后重启验证
  await win.evaluate(() => window.MarkFlow.api.setSettings({
    signatureName: '持久化测试名',
    signatureEmail: 'persist@test.local',
  }));
  await win.waitForTimeout(500);
  await app.close();
  // 注意：app.close() 后 win 已失效，不能用 page.waitForTimeout；用普通定时器等单实例锁释放
  await new Promise((r) => setTimeout(r, 800));

  const app2 = await electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const win2 = await app2.firstWindow();
  await win2.waitForSelector('#toolbar', { timeout: 20000 });
  await win2.waitForTimeout(600);
  await win2.evaluate((d) => window.MarkFlow.setWorkingDir(d), SAMPLE_DIR);
  await win2.evaluate((p) => window.MarkFlow.openFile(p), SAMPLE);
  await win2.evaluate(() => window.MarkFlow.setMode('split'));
  await win2.waitForTimeout(900);
  const persisted = await win2.evaluate(() => {
    const s = window.MarkFlow.getState().settings;
    const sig = document.querySelector('#preview .doc-signature');
    const nameEl = sig ? sig.querySelector('.sig-name') : null;
    const emailEl = sig ? sig.querySelector('.sig-email a') : null;
    return {
      cfgName: s.signatureName,
      cfgEmail: s.signatureEmail,
      renderedName: nameEl ? nameEl.textContent : '',
      renderedEmail: emailEl ? emailEl.textContent : '',
    };
  });
  check('重启后设置项仍为修改后的署名（固化）',
    persisted.cfgName === '持久化测试名' && persisted.cfgEmail === 'persist@test.local',
    JSON.stringify(persisted));
  check('重启后预览落款显示修改后的署名（固化）',
    persisted.renderedName === '持久化测试名' && persisted.renderedEmail === 'persist@test.local',
    JSON.stringify(persisted));

  // 恢复默认署名：必须走「关于」对话框输入（经 applySettings 同步渲染进程 state 并落盘），
  // 直接调 api.setSettings 只落盘、不更新渲染进程 state，预览不会变
  await win2.evaluate(() => window.MarkFlow.openAbout());
  await win2.waitForTimeout(400);
  await win2.fill('#about-modal [data-k="signatureName"]', '许帆');
  await win2.fill('#about-modal [data-k="signatureEmail"]', 'cfanx@163.com');
  await win2.waitForTimeout(800); // 250ms 防抖 + 重绘
  const restoredDefault = await win2.evaluate(() => {
    const s = window.MarkFlow.getState().settings;
    const n = document.querySelector('#preview .doc-signature .sig-name');
    const e = document.querySelector('#preview .doc-signature .sig-email a');
    return {
      ok: s.signatureName === '许帆' && s.signatureEmail === 'cfanx@163.com'
        && !!n && n.textContent === '许帆' && !!e && e.textContent === 'cfanx@163.com',
      cfgName: s.signatureName,
      cfgEmail: s.signatureEmail,
      renderedName: n ? n.textContent : null,
      renderedEmail: e ? e.textContent : null,
    };
  });
  check('恢复默认署名（许帆 / cfanx@163.com）', !!restoredDefault.ok, JSON.stringify(restoredDefault));
  await win2.screenshot({ path: path.join(SHOTS, '13-signature-persist.png') });
  log('[shot] 13 signature persist');
  await app2.close();

  const modeChecksOk = checks.every((c) => c.pass);
  const ok = modeChecksOk && hasTyped && tocCount > 0 && codeBlocks >= 2 && taskBoxes >= 3 && treeItems >= 1 && errors.length === 0;
  log(ok ? 'E2E PASS ✅' : 'E2E FAIL ❌');
  if (!ok) {
    log('failed checks:', checks.filter((c) => !c.pass).map((c) => c.name).join(', ') || '(none in mode checks)');
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('E2E ERROR', e); process.exit(2); });
