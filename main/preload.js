/**
 * MarkFlow - preload 脚本
 * 通过 contextBridge 向渲染层暴露最小化的安全 API。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* ---------- 对话框 ---------- */
  openFileDialog: (opts) => ipcRenderer.invoke('dialog:openFile', opts || {}),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath || ''),
  openDirDialog: () => ipcRenderer.invoke('dialog:openDir'),

  /* ---------- 文件读写 ---------- */
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content, bom) => ipcRenderer.invoke('fs:writeFile', filePath, content, !!bom),

  /* ---------- 目录与搜索 ---------- */
  listDir: (dir, sortBy) => ipcRenderer.invoke('fs:listDir', dir, sortBy || 'name'),
  listChildren: (dir, sortBy) => ipcRenderer.invoke('fs:listChildren', dir, sortBy || 'name'),
  searchDir: (dir, query, opts) => ipcRenderer.invoke('fs:searchDir', dir, query, opts || {}),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  /* ---------- 文件监视 ---------- */
  watchStart: (dir) => ipcRenderer.invoke('watch:start', dir),
  watchStop: (dir) => ipcRenderer.invoke('watch:stop', dir || ''),

  /* ---------- 设置 / 最近文件 / 会话 ---------- */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch || {}),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  addRecent: (filePath) => ipcRenderer.invoke('recent:add', filePath),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  getSession: () => ipcRenderer.invoke('session:get'),
  saveSession: (data) => ipcRenderer.invoke('session:save', data || {}),
  saveSessionSync: (data) => ipcRenderer.sendSync('session:saveSync', data || {}),

  /* ---------- 应用级 ---------- */
  getVersion: () => ipcRenderer.invoke('app:version'),
  getInitialFiles: () => ipcRenderer.invoke('app:getInitialFiles'),
  logError: (scope, detail) => ipcRenderer.invoke('log:error', scope, detail),
  registerFileAssoc: () => ipcRenderer.invoke('app:registerAssoc'),
  unregisterFileAssoc: () => ipcRenderer.invoke('app:unregisterAssoc'),
  setWindowTitle: (title) => ipcRenderer.invoke('window:setTitle', title),
  showContextMenu: (items) => ipcRenderer.invoke('menu:context', items || []),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onTreeChanged: (cb) => {
    const h = (_e, dir) => cb(dir);
    ipcRenderer.on('fs:treeChanged', h);
    return () => ipcRenderer.removeListener('fs:treeChanged', h);
  },
  /* ---------- 主进程 → 渲染进程 事件 ---------- */
  onMenuAction: (cb) => {
    const h = (_e, action) => cb(action);
    ipcRenderer.on('menu:action', h);
    return () => ipcRenderer.removeListener('menu:action', h);
  },
  onOpenFiles: (cb) => {
    const h = (_e, paths) => cb(paths);
    ipcRenderer.on('open:files', h);
    return () => ipcRenderer.removeListener('open:files', h);
  },
  onFileChanged: (cb) => {
    const h = (_e, filePath, eventType) => cb(filePath, eventType);
    ipcRenderer.on('fs:changed', h);
    return () => ipcRenderer.removeListener('fs:changed', h);
  },
  onWatchError: (cb) => {
    const h = (_e, message) => cb(message);
    ipcRenderer.on('watch:error', h);
    return () => ipcRenderer.removeListener('watch:error', h);
  },
});
