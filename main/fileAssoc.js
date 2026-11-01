/**
 * MarkFlow - 文件关联注册（T1）
 * 写入 HKCU\Software\Classes 下的 .md / .markdown 扩展名条目，无需管理员权限。
 * 卸载/清理时删除。（实际卸载由 installer 处理；此处提供运行时注册入口。）
 */
const { execFile } = require('child_process');
const path = require('path');

const PROGID = 'MarkFlow.mdfile';
const EXTENSIONS = ['.md', '.markdown'];

function runReg(args) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

/** 读取某键的默认值（不存在返回空串） */
async function queryDefault(key) {
  try {
    const out = await runReg(['query', key, '/ve']);
    const m = /\s+REG_SZ\s+(.*)$/m.exec(String(out));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

async function register(execPath) {
  const target = `"${execPath}" "%1"`;
  const results = [];
  for (const ext of EXTENSIONS) {
    const key = `HKCU\\Software\\Classes\\${ext}`;
    await runReg(['add', key, '/ve', '/t', 'REG_SZ', '/d', PROGID, '/f']);
    results.push(`已注册 ${ext} -> ${PROGID}`);
  }
  const cmdKey = `HKCU\\Software\\Classes\\${PROGID}\\shell\\open\\command`;
  await runReg(['add', `HKCU\\Software\\Classes\\${PROGID}`, '/ve', '/t', 'REG_SZ', '/d', 'Markdown 文档', '/f']);
  // 注意：DefaultIcon 的值不能带内嵌引号，否则资源管理器无法解析；附带图标索引 ,0
  await runReg(['add', `HKCU\\Software\\Classes\\${PROGID}\\DefaultIcon`, '/ve', '/t', 'REG_SZ', '/d', `${execPath},0`, '/f']);
  await runReg(['add', cmdKey, '/ve', '/t', 'REG_SZ', '/d', target, '/f']);
  // 在「打开方式」列表中露出
  const openWithKey = `HKCU\\Software\\Classes\\Applications\\MarkFlow.exe\\shell\\open\\command`;
  await runReg(['add', openWithKey, '/ve', '/t', 'REG_SZ', '/d', target, '/f']);
  return { ok: true, results: [...results, `已写入命令: ${target}`] };
}

async function unregister() {
  const results = [];
  for (const ext of EXTENSIONS) {
    // 仅当默认值确实指向 MarkFlow 时才删除，避免误伤用户/其他程序已有的关联配置
    const cur = await queryDefault(`HKCU\\Software\\Classes\\${ext}`);
    if (cur === PROGID) {
      await runReg(['delete', `HKCU\\Software\\Classes\\${ext}`, '/f']).catch(() => {});
      results.push(`已清理 ${ext}`);
    } else {
      results.push(`${ext} 未指向 MarkFlow，跳过`);
    }
  }
  await runReg(['delete', `HKCU\\Software\\Classes\\${PROGID}`, '/f']).catch(() => {});
  await runReg(['delete', `HKCU\\Software\\Classes\\Applications\\MarkFlow.exe`, '/f']).catch(() => {});
  results.push(`已清理 ${PROGID}`);
  return { ok: true, results };
}

module.exports = { register, unregister };
