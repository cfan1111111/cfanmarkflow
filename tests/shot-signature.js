/* MarkFlow - 落款效果截图（滚动到预览区底部） */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname.replace(/\\/g, '/').replace(/\/tests$/, '');
const ELECTRON = process.env.MF_E2E_EXE
  ? process.env.MF_E2E_EXE
  : path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const SAMPLE_DIR = path.join(ROOT, 'samples').replace(/\\/g, '/');
const SAMPLE = path.join(SAMPLE_DIR, '示例文档.md').replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const env = { ...process.env, MF_TEST: '1', MARKFLOW_GPU: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const win = await app.firstWindow();
  await win.waitForSelector('#toolbar', { timeout: 20000 });
  await win.waitForTimeout(800);

  await win.evaluate((d) => window.MarkFlow.setWorkingDir(d), SAMPLE_DIR);
  await win.waitForTimeout(400);
  await win.evaluate((p) => window.MarkFlow.openFile(p), SAMPLE);
  await win.waitForTimeout(1000);

  // 滚到预览区底部，露出落款
  await win.evaluate(() => {
    const p = document.querySelector('#preview-pane');
    if (p) p.scrollTop = p.scrollHeight;
  });
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, '09-signature-bottom.png') });
  console.log('[shot] 09 signature bottom');

  // 阅读模式下的落款
  await win.evaluate(() => window.MarkFlow.setMode('read'));
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    const p = document.querySelector('#preview-pane');
    if (p) p.scrollTop = p.scrollHeight;
  });
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, '10-signature-read.png') });
  console.log('[shot] 10 signature read');

  // 设置面板中的署名分组
  await win.evaluate(() => window.MarkFlow.setMode('split'));
  await win.click('#btn-settings');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, '11-settings-signature.png') });
  console.log('[shot] 11 settings signature');

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });
