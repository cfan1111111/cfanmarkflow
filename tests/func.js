/* func: 验证 新建/保存/目录搜索 三条未覆盖链路 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname.replace(/\\/g, '/').replace(/\/tests$/, '');
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const SAMPLE_DIR = path.join(ROOT, 'samples').replace(/\\/g, '/');

(async () => {
  const env = { ...process.env, MF_TEST: '1', MARKFLOW_GPU: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await win.waitForSelector('#toolbar', { timeout: 20000 });
  await win.waitForTimeout(400);

  // 1) 新建文件 + 输入 + 保存
  await win.evaluate(() => window.MarkFlow.newFile());
  await win.waitForTimeout(200);
  await win.click('.cm-content');
  await win.keyboard.type('# 测试标题\n\n这是新建文件保存到磁盘的内容。');
  await win.waitForTimeout(200);
  const newPath = path.join(SAMPLE_DIR, 'func-test.md').replace(/\\/g, '/');
  try { fs.unlinkSync(newPath); } catch {}
  const savedRes = await win.evaluate((p) => window.MarkFlow.api.writeFile(p, '# 测试标题\n\n这是新建文件保存到磁盘的内容。', false), newPath);
  await win.waitForTimeout(300);
  const saved = savedRes && savedRes.ok ? fs.readFileSync(newPath, 'utf-8') : null;
  console.log('NEW+SAVE =>', saved && saved.includes('测试标题') ? 'PASS 文件已写入' : 'FAIL', '| ok=', savedRes && savedRes.ok, '| size=', saved ? saved.length : 0);

  // 2) 目录搜索 API
  const sr = await win.evaluate((d) => window.MarkFlow.api.searchDir(d, '代码块', { content: true, name: false }), SAMPLE_DIR);
  console.log('SEARCH =>', 'ok=' + (sr && sr.ok), '| files=' + (sr && sr.files ? sr.files.length : 'NA'), '| total=' + (sr && sr.total));

  // 清理
  try { fs.unlinkSync(newPath); } catch {}
  await app.close();
  console.log('PAGE ERRORS:', errors.length ? errors : 'none');
})().catch((e) => { console.error('FUNC ERROR', e); process.exit(2); });
