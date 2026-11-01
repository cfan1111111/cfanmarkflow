/**
 * MarkFlow - 打包脚本（Windows 便携版）
 *
 * 为什么不用命令行 --ignore：
 *   electron-packager 的 --ignore 正则在 Windows 上按路径分隔符匹配，
 *   本机实测 `^/(tests|shots|...)` 与 `[\\/](tests|shots|...)[\\/]` 均未生效，
 *   产物里始终残留 tests/ 与 shots/（约 2.5MB 无用文件）。
 *   改为在脚本内直接用正则数组排除，并强制校验。
 */
const path = require('path');
const fs = require('fs');
const packager = require('electron-packager');

const VERSION = require('./package.json').version;
const OUT = path.join(__dirname, 'dist');
const APP_DIR = path.join(OUT, 'MarkFlow-win32-x64', 'resources', 'app');

/** 需要排除的目录名 */
const EXCLUDE_DIRS = ['tests', 'shots', 'dist', 'elog'];
const ignorePattern = new RegExp(`[\\\\/](${EXCLUDE_DIRS.join('|')})[\\\\/]`);

(async () => {
  const paths = await packager({
    dir: __dirname,
    name: 'MarkFlow',
    platform: 'win32',
    arch: 'x64',
    out: OUT,
    overwrite: true,
    prune: true,
    appVersion: VERSION,
    ignore: [ignorePattern],
  });
  console.log('[pack] 完成:', paths.join(', '));

  // 兜底清理：正则未生效时直接删除，保证产物干净
  let removed = [];
  for (const d of EXCLUDE_DIRS) {
    const target = path.join(APP_DIR, d);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(d);
    }
  }
  if (removed.length) console.log('[pack] 兜底清理:', removed.join(', '));

  // 校验：产物中不应再出现被排除的目录
  const leftovers = EXCLUDE_DIRS.filter((d) => fs.existsSync(path.join(APP_DIR, d)));
  if (leftovers.length) {
    console.error('[pack] 失败：产物仍包含', leftovers.join(', '));
    process.exit(1);
  }
  console.log('[pack] 校验通过，产物目录：', fs.readdirSync(APP_DIR).join(', '));
})().catch((e) => { console.error('[pack] 失败:', e); process.exit(1); });
