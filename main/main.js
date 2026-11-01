/**
 * MarkFlow - 主进程入口
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem } = require('electron');

/* 受限/无 GPU 环境（沙箱、容器、部分虚拟机、CI 测试）下禁用硬件加速与沙箱，
   避免 GPU 进程以访问违规崩溃，进而拖垮整个应用。
   正常 Windows 桌面（Win10 1809+ 且具备 GPU）默认保留 GPU 与沙箱以获得最佳体验。 */
const headlessLike = process.env.MARKFLOW_GPU === 'off' || process.env.ELECTRON_DISABLE_GPU === '1';
if (headlessLike) {
  if (typeof app.disableHardwareAcceleration === 'function') app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('no-sandbox');
}
app.commandLine.appendSwitch('disable-dev-shm-usage');
const { SettingsStore } = require('./settingsStore');
const { SessionStore } = require('./sessionStore');
const fm = require('./fileManager');
const assoc = require('./fileAssoc');
const { buildMenu } = require('./menu');

const userData = app.getPath('userData');
const settings = new SettingsStore(userData);
const sessionStore = new SessionStore(userData);

/* ---------- 错误日志（userData/logs/markflow-error.log，排障用） ---------- */
const LOG_DIR = path.join(userData, 'logs');
function logError(scope, detail) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = `[${new Date().toISOString()}] [${scope}] ${String(detail && detail.stack || detail).slice(0, 2000)}\n`;
    fs.appendFileSync(path.join(LOG_DIR, 'markflow-error.log'), line, 'utf-8');
  } catch { /* noop：日志失败不能影响主流程 */ }
}
process.on('uncaughtException', (e) => logError('main.uncaughtException', e));
process.on('unhandledRejection', (e) => logError('main.unhandledRejection', e));

let mainWindow = null;
let pendingFiles = [];

/* ---------- 文件监视（按目录引用计数，覆盖文件树 + 所有已打开文件） ---------- */
const watchers = new Map(); // dir -> { watcher, ref, timer, changed:Set }
function watchDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  const existing = watchers.get(dir);
  if (existing) { existing.ref++; return; }
  let watcher;
  try {
    watcher = fs.watch(dir, { recursive: true }, (eventType, fileName) => {
      const entry = watchers.get(dir);
      if (!entry) return;
      if (fileName) entry.changed.add(path.join(dir, fileName));
      else entry.changed.add(dir);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => flushChanges(dir), 200);
    });
  } catch (e) {
    console.warn('[watch] 无法监视目录', dir, e.message);
    return;
  }
  watcher.on('error', (e) => {
    console.warn('[watch] 错误', dir, e.message);
    if (mainWindow) mainWindow.webContents.send('watch:error', e.message);
  });
  watchers.set(dir, { watcher, ref: 1, timer: null, changed: new Set() });
}
function unwatchDir(dir) {
  const entry = watchers.get(dir);
  if (!entry) return;
  entry.ref--;
  if (entry.ref <= 0) {
    try { entry.watcher.close(); } catch { /* noop */ }
    if (entry.timer) clearTimeout(entry.timer);
    watchers.delete(dir);
  }
}
function flushChanges(dir) {
  const entry = watchers.get(dir);
  if (!entry) return;
  const changed = Array.from(entry.changed);
  entry.changed.clear();
  for (const p of changed) {
    if (mainWindow) mainWindow.webContents.send('fs:changed', p, 'change');
  }
  if (mainWindow) mainWindow.webContents.send('fs:treeChanged', dir);
}

/* ---------- 窗口 ---------- */
function createWindow() {
  const w = settings.get().window;
  mainWindow = new BrowserWindow({
    width: w.width || 1360,
    height: w.height || 860,
    x: typeof w.x === 'number' ? w.x : undefined,
    y: typeof w.y === 'number' ? w.y : undefined,
    minWidth: 800,
    minHeight: 520,
    show: false,
    title: 'MarkFlow',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (w.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 冷启动时不在此发送待打开文件：渲染进程 init() 为 async（需 await 加载设置/会话），
    // 此时编辑器/标签系统尚未就绪，send 的 open:files 会被 openFile 静默丢弃，导致「首次双击不打开」。
    // 改为由渲染端 init() 完成后通过 app:getInitialFiles 主动拉取（见 renderer/js/app.js）。
  });

  mainWindow.on('close', () => {
    const b = mainWindow.getBounds();
    settings.saveWindow({ ...b, maximized: mainWindow.isMaximized() });
  });

  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  return mainWindow;
}

/* ---------- 应用菜单 ---------- */
let recentMenuItem = null; // 「最近文件」菜单项（Menu.item），其 .submenu 才是 Menu
function refreshRecentMenu() {
  const sub = recentMenuItem && recentMenuItem.submenu;
  if (!sub) return;
  sub.clear();
  const recents = settings.get().recentFiles || [];
  if (!recents.length) {
    sub.append(new MenuItem({ label: '(空)', enabled: false }));
    return;
  }
  recents.forEach((r, i) => {
    sub.append(new MenuItem({
      label: `${i + 1}. ${r.name || path.basename(r.path)}`,
      click: () => { if (mainWindow) mainWindow.webContents.send('open:files', [r.path]); },
    }));
  });
  sub.append(new MenuItem({ type: 'separator' }));
  sub.append(new MenuItem({ label: '清除最近文件', click: () => { settings.clearRecent(); refreshRecentMenu(); } }));
}

function setupMenu() {
  const built = buildMenu((action) => {
    if (mainWindow) mainWindow.webContents.send('menu:action', action);
  });
  recentMenuItem = built.recentSubmenu;
  Menu.setApplicationMenu(built.menu);
  refreshRecentMenu();
}

/* ---------- IPC ---------- */
function registerIpc() {
  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: '全部文件', extensions: ['*'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:saveFile', async (_, defaultPath) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:openDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:readFile', (_, filePath) => {
    try { return { ok: true, ...fm.readFile(filePath) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('fs:writeFile', (_, filePath, content, bom) => {
    try {
      const res = fm.writeFileAtomic(filePath, content, bom);
      return { ok: true, ...res };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('fs:listDir', (_, dir, sortBy) => {
    try { return { ok: true, tree: fm.listDir(dir, sortBy) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  /* 懒加载：只列一层，供文件树展开时按需拉取，避免大目录全量遍历阻塞主进程 */
  ipcMain.handle('fs:listChildren', (_, dir, sortBy) => {
    try { return { ok: true, nodes: fm.listChildren(dir, sortBy) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('fs:searchDir', (_, dir, query, opts) => {
    try { return { ok: true, ...fm.searchDir(dir, query, opts) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('shell:showItemInFolder', (_, filePath) => { try { shell.showItemInFolder(filePath); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('shell:openExternal', (_, url) => { try { shell.openExternal(url); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });

  ipcMain.handle('watch:start', (_, dir) => { watchDir(dir); return { ok: true }; });
  ipcMain.handle('watch:stop', (_, dir) => { unwatchDir(dir); return { ok: true }; });

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_, patch) => settings.set(patch));
  ipcMain.handle('recent:get', () => settings.get().recentFiles);
  ipcMain.handle('recent:add', (_, filePath, name) => { const r = settings.addRecent(filePath, name); refreshRecentMenu(); return r; });
  ipcMain.handle('recent:clear', () => { const r = settings.clearRecent(); refreshRecentMenu(); return r; });

  ipcMain.handle('session:get', () => sessionStore.get());
  ipcMain.handle('session:save', (_, data) => sessionStore.save(data));
  ipcMain.on('session:saveSync', (e, data) => { sessionStore.save(data); });

  ipcMain.handle('log:error', (_, scope, detail) => { logError(scope || 'renderer', detail); return { ok: true }; });

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:registerAssoc', () => assoc.register(process.execPath).catch((e) => ({ ok: false, error: e.message })));
  ipcMain.handle('app:unregisterAssoc', () => assoc.unregister().catch((e) => ({ ok: false, error: e.message })));
  ipcMain.handle('window:setTitle', (_, title) => { if (mainWindow) mainWindow.setTitle(title); return true; });

  /* 冷启动：渲染端 init() 完成后主动拉取待打开文件，消除「首次双击 .md 不打开」的竞态 */
  ipcMain.handle('app:getInitialFiles', () => {
    const files = pendingFiles;
    pendingFiles = [];
    return files;
  });

  ipcMain.handle('menu:context', (_, items) => {
    return new Promise((resolve) => {
      const template = items.map((it) => ({
        label: it.label,
        type: it.type || 'normal',
        enabled: it.enabled !== false,
        click: () => { if (it.action) resolve(it.action); },
      }));
      if (!template.length) return resolve(null);
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow, callback: () => resolve(null) });
    });
  });
}

/* ---------- 启动 / 单实例 ---------- */
const gotLock = app.requestSingleInstanceLock();

function collectArgvFiles(argv) {
  return argv.filter((a) => /\.(md|markdown)$/i.test(a) && fs.existsSync(a));
}

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const files = collectArgvFiles(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (files.length) mainWindow.webContents.send('open:files', files);
    } else {
      pendingFiles = files;
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    setupMenu();
    pendingFiles = collectArgvFiles(process.argv); // 冷启动待打开文件先入队（早于窗口创建）
    createWindow();

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    for (const { watcher } of watchers.values()) { try { watcher.close(); } catch { /* noop */ } }
    if (process.platform !== 'darwin') app.quit();
  });
}
