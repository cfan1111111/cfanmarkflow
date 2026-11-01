/* MarkFlow - 渲染层打包（esbuild） */
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ['renderer/js/app.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  outfile: 'renderer/bundle.js',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (watch) {
  opts.watch = { onRebuild(err) { if (err) console.error('[build] 失败', err.message); else console.log('[build] 已重新打包'); } };
}

esbuild.build(opts).then(() => console.log('[build] bundle.js 打包完成')).catch((e) => { console.error(e); process.exit(1); });
