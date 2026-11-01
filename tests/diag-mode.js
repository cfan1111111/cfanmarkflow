/* MarkFlow - 诊断：打开文档时 tab.mode 的实际来源 */
const { _electron: electron } = require('playwright-core');
const path = require('path');

const ROOT = __dirname.replace(/\\/g, '/').replace(/\/tests$/, '');
const ELECTRON = process.env.MF_E2E_EXE
  ? process.env.MF_E2E_EXE
  : path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const SAMPLE_DIR = path.join(ROOT, 'samples').replace(/\\/g, '/');
const SAMPLE = path.join(SAMPLE_DIR, '示例文档.md').replace(/\\/g, '/');

(async () => {
  const env = { ...process.env, MF_TEST: '1', MARKFLOW_GPU: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const win = await app.firstWindow();
  await win.waitForSelector('#toolbar', { timeout: 20000 });
  await win.waitForTimeout(1200);

  const before = await win.evaluate(() => ({
    settingsDefaultMode: window.MarkFlow.getState().settings
      ? window.MarkFlow.getState().settings.defaultMode : '(no settings)',
    tabsCount: window.MarkFlow.getState().tabs.length,
    tabModes: window.MarkFlow.getState().tabs.map((t) => ({ name: t.name, mode: t.mode, path: t.path })),
  }));
  console.log('BEFORE openFile:', JSON.stringify(before, null, 2));

  await win.evaluate((d) => window.MarkFlow.setWorkingDir(d), SAMPLE_DIR);
  await win.waitForTimeout(400);
  await win.evaluate((p) => window.MarkFlow.openFile(p), SAMPLE);
  await win.waitForTimeout(900);

  const after = await win.evaluate(() => ({
    settingsDefaultMode: window.MarkFlow.getState().settings
      ? window.MarkFlow.getState().settings.defaultMode : '(no settings)',
    tabModes: window.MarkFlow.getState().tabs.map((t) => ({ name: t.name, mode: t.mode })),
  }));
  console.log('AFTER openFile:', JSON.stringify(after, null, 2));

  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });
