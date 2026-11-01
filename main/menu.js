/**
 * MarkFlow - 应用菜单（中文，符合 Windows 习惯）
 * 通过 'menu:action' 事件把动作名发给渲染层统一处理。
 */
const { Menu } = require('electron');

function buildMenu(sendAction) {
  const a = (label, accelerator, action, type) => ({
    label, accelerator, click: () => sendAction(action), ...(type ? { type } : {}),
  });

  const template = [
    {
      label: '文件',
      submenu: [
        a('新建', 'Ctrl+N', 'file:new'),
        a('打开…', 'Ctrl+O', 'file:open'),
        a('打开目录…', '', 'file:openDir'),
        { type: 'separator' },
        a('保存', 'Ctrl+S', 'file:save'),
        a('另存为…', 'Ctrl+Shift+S', 'file:saveAs'),
        a('关闭标签页', 'Ctrl+W', 'file:closeTab'),
        { type: 'separator' },
        {
          label: '最近文件',
          submenu: [
            { label: '(空)', enabled: false },
          ],
          id: 'recent',
        },
        { type: 'separator' },
        a('退出', 'Alt+F4', 'app:quit'),
      ],
    },
    {
      label: '编辑',
      submenu: [
        a('撤销', 'Ctrl+Z', 'edit:undo'),
        a('重做', 'Ctrl+Y', 'edit:redo'),
        { type: 'separator' },
        a('查找', 'Ctrl+F', 'edit:find'),
        a('替换', 'Ctrl+H', 'edit:replace'),
        { type: 'separator' },
        a('剪切', 'Ctrl+X', 'edit:cut'),
        a('复制', 'Ctrl+C', 'edit:copy'),
        a('粘贴', 'Ctrl+V', 'edit:paste'),
        a('全选', 'Ctrl+A', 'edit:selectAll'),
      ],
    },
    {
      label: '视图',
      submenu: [
        a('切换显示模式（阅读 / 编辑 / 阅读和编辑）', 'F2', 'view:toggleMode'),
        { type: 'separator' },
        a('阅读和编辑（并排）', '', 'view:split'),
        a('阅读（仅预览）', '', 'view:previewOnly'),
        a('编辑（仅源码）', '', 'view:editorOnly'),
        { type: 'separator' },
        a('切换明暗主题', 'Ctrl+Shift+T', 'view:toggleTheme'),
        a('切换文件树', 'Ctrl+Shift+L', 'view:toggleFileTree'),
        a('切换目录大纲', 'Ctrl+Shift+O', 'view:toggleToc'),
        { type: 'separator' },
        a('放大', 'Ctrl+=', 'view:zoomIn'),
        a('缩小', 'Ctrl+-', 'view:zoomOut'),
        a('重置缩放', 'Ctrl+0', 'view:zoomReset'),
      ],
    },
    {
      label: '工具',
      submenu: [
        a('目录搜索 (多文件)', 'Ctrl+Shift+F', 'tools:searchDir'),
        a('设置', '', 'tools:settings'),
        { type: 'separator' },
        a('注册为 .md 默认打开方式', '', 'tools:registerAssoc'),
        a('清除文件关联', '', 'tools:unregisterAssoc'),
      ],
    },
    {
      label: '帮助',
      submenu: [
        a('关于 MarkFlow', '', 'help:about'),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  return { menu, recentSubmenu: menu.getMenuItemById('recent') };
}

module.exports = { buildMenu };
