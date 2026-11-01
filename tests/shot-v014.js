/* MarkFlow - v0.1.4 界面截图：关于对话框 / 编辑模式单栏 / 目录跳转 */
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

for (const name of ['MarkFlow.exe', 'electron.exe']) {
  try { execSync(`taskkill /F /IM ${name} /T`, { stdio: 'ignore' }); } catch { /* 无残留 */ }
}

(async () => {
  const env = { ...process.env, MF_TEST: '1', MARKFLOW_GPU: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const win = await app.firstWindow();
  await win.waitForSelector('#toolbar', { timeout: 20000 });
  await win.waitForTimeout(1000);

  await win.evaluate((d) => window.MarkFlow.setWorkingDir(d), SAMPLE_DIR);
  await win.waitForTimeout(400);
  await win.evaluate((p) => window.MarkFlow.openFile(p), SAMPLE);
  await win.waitForTimeout(1000);

  // 1) 「关于」对话框
  await win.evaluate(() => window.MarkFlow.openAbout());
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, '13-about.png') });
  console.log('[shot] 13 about');

  // 2) 编辑模式单栏
  await win.click('#about-modal [data-act="close"]');
  await win.waitForTimeout(300);
  await win.evaluate(() => window.MarkFlow.setMode('edit'));
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, '14-edit-single-pane.png') });
  console.log('[shot] 14 edit single pane');

  // 3) 编辑模式点目录跳转（跳到"6. 数学与扩展"）
  await win.evaluate(async () => {
    const items = Array.from(document.querySelectorAll('.toc-item'));
    const target = items.find((i) => /数学与扩展/.test(i.textContent)) || items[items.length - 1];
    target.click();
  });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, '15-edit-toc-jump.png') });
  console.log('[shot] 15 edit toc jump');

  const jumpInfo = await win.evaluate(() => ({
    cursorLine: window.MarkFlow.getCursorLine(),
    activeToc: (document.querySelector('.toc-item.active') || {}).textContent || '',
  }));
  console.log('跳转结果:', JSON.stringify(jumpInfo));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });
