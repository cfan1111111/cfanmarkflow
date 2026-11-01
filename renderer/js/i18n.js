/* MarkFlow - 国际化（简体中文为主，英文兜底） */
const dict = {
  'zh-CN': {
    'app.name': 'MarkFlow',
    'tb.open': '打开文件', 'tb.new': '新建', 'tb.save': '保存', 'tb.saveAs': '另存为',
    'tb.readMode': '阅读模式', 'tb.editMode': '编辑模式', 'tb.searchDir': '目录搜索', 'tb.settings': '设置', 'tb.theme': '主题',
    'tb.modeRead': '阅读', 'tb.modeEdit': '编辑', 'tb.modeSplit': '阅读和编辑', 'tb.modeSwitchHint': '切换显示模式（F2）',
    'tb.changeDir': '选择目录', 'tb.sort': '排序', 'tb.treeCollapse': '折叠文件树', 'tb.tocCollapse': '折叠目录',
    'tree.title': '文件', 'tree.empty': '空目录', 'tree.loading': '加载中…',
    'toc.title': '目录', 'toc.empty': '（无标题）',
    'welcome.title': 'MarkFlow', 'welcome.subtitle': 'Windows 上的 Markdown 阅读与编辑器',
    'welcome.new': '新建文档', 'welcome.open': '打开文件', 'welcome.openDir': '打开目录',
    'welcome.recent': '最近文件', 'welcome.noRecent': '暂无最近文件',
    'st.modeRead': '阅读模式', 'st.modeEdit': '编辑模式', 'st.modeSplit': '阅读和编辑模式', 'st.saved': '已保存', 'st.unsaved': '未保存',
    'st.encoding': '编码', 'st.words': '字数', 'st.cursor': '光标',
    'set.title': '设置', 'set.close': '关闭',
    'set.theme': '主题', 'set.themeSys': '跟随系统', 'set.themeLight': '亮色', 'set.themeDark': '暗色',
    'set.language': '界面语言', 'set.zh': '简体中文', 'set.en': 'English',
    'set.font': '正文字体', 'set.codeFont': '代码字体', 'set.fontSize': '字号',
    'set.autosave': '自动保存', 'set.autosaveOn': '开启', 'set.autosaveOff': '关闭', 'set.autosaveInterval': '自动保存间隔（秒）',
    'set.defaultMode': '默认打开模式', 'set.defaultModeHint': '新打开的文档使用的显示模式',
    'set.modeRead': '阅读', 'set.modeEdit': '编辑', 'set.modeSplit': '阅读和编辑',
    'set.ui': '界面', 'set.showTree': '显示文件树', 'set.showToc': '显示目录大纲', 'set.splitReset': '重置分屏比例',
    'set.signature': '署名', 'set.signatureShow': '显示落款', 'set.signatureName': '署名',
    'set.signatureEmail': '邮箱', 'set.signatureNamePh': '例如：许帆', 'set.signatureEmailPh': '例如：cfanx@163.com',
    'set.signatureHint': '在阅读视图的文档末尾自动显示署名与邮箱，不修改源文件内容',
    'set.assoc': '文件关联', 'set.register': '注册为 .md 默认程序', 'set.unregister': '清除文件关联',
    'set.clearRecent': '清除最近文件', 'set.about': '关于',
    'about.title': '关于 MarkFlow', 'about.version': '版本 {ver}',
    'about.desc': 'Windows 上的 Markdown 阅读与编辑器 · 基于 Electron + CodeMirror 6 + markdown-it 构建',
    'search.title': '目录搜索', 'search.placeholder': '输入关键词，支持跨文件搜索…', 'search.case': '区分大小写',
    'search.name': '文件名', 'search.content': '内容', 'search.empty': '无结果',
    'search.results': '共 {n} 个匹配',
    'tb.bold': '加粗', 'tb.italic': '斜体', 'tb.strike': '删除线', 'tb.code': '行内代码', 'tb.link': '链接',
    'tb.image': '图片', 'tb.headingUp': '标题升级', 'tb.headingDown': '标题降级', 'tb.quote': '引用',
    'tb.ul': '无序列表', 'tb.ol': '有序列表', 'tb.task': '任务列表', 'tb.table': '表格', 'tb.codeblock': '代码块', 'tb.hr': '分割线',
    'view.split': '分屏', 'view.preview': '仅预览', 'view.editor': '仅源码',
    'msg.saved': '已保存', 'msg.autosaved': '已自动保存', 'msg.externalChange': '文件已被外部程序修改', 'msg.reload': '重新加载', 'msg.ignore': '忽略',
    'msg.confirmClose': '该文件有未保存的修改，确定关闭吗？', 'msg.save': '保存', 'msg.dontSave': '不保存', 'msg.cancel': '取消',
    'msg.assocOn': '已注册文件关联', 'msg.assocOff': '已清除文件关联', 'msg.about': 'MarkFlow v{ver} · 基于 Electron + CodeMirror 6 + markdown-it 构建。',
    'msg.noDir': '请先在文件树选择目录', 'msg.openFail': '打开失败', 'msg.saveFail': '保存失败',
    'msg.encodingUpgraded': '文件已从 GBK 编码转换为 UTF-8 保存',
    'msg.autosaveUnnamed': '未命名文件无法自动保存，请先手动保存',
    'drop.hint': '拖放到此处打开 Markdown 文件',
  },
  'en': {
    'app.name': 'MarkFlow',
    'tb.open': 'Open', 'tb.new': 'New', 'tb.save': 'Save', 'tb.saveAs': 'Save As',
    'tb.readMode': 'Read', 'tb.editMode': 'Edit', 'tb.searchDir': 'Search', 'tb.settings': 'Settings', 'tb.theme': 'Theme',
    'tb.modeRead': 'Read', 'tb.modeEdit': 'Edit', 'tb.modeSplit': 'Read + Edit', 'tb.modeSwitchHint': 'Switch display mode (F2)',
    'tb.changeDir': 'Choose Folder', 'tb.sort': 'Sort', 'tb.treeCollapse': 'Collapse', 'tb.tocCollapse': 'Collapse',
    'tree.title': 'Files', 'tree.empty': 'Empty', 'tree.loading': 'Loading…',
    'toc.title': 'Outline', 'toc.empty': '(no headings)',
    'welcome.title': 'MarkFlow', 'welcome.subtitle': 'Markdown reader & editor for Windows',
    'welcome.new': 'New Document', 'welcome.open': 'Open File', 'welcome.openDir': 'Open Folder',
    'welcome.recent': 'Recent', 'welcome.noRecent': 'No recent files',
    'st.modeRead': 'Read', 'st.modeEdit': 'Edit', 'st.modeSplit': 'Read + Edit', 'st.saved': 'Saved', 'st.unsaved': 'Unsaved',
    'st.encoding': 'Enc', 'st.words': 'Words', 'st.cursor': 'Cursor',
    'set.title': 'Settings', 'set.close': 'Close',
    'set.theme': 'Theme', 'set.themeSys': 'System', 'set.themeLight': 'Light', 'set.themeDark': 'Dark',
    'set.language': 'Language', 'set.zh': '简体中文', 'set.en': 'English',
    'set.font': 'Body Font', 'set.codeFont': 'Code Font', 'set.fontSize': 'Font Size',
    'set.autosave': 'Autosave', 'set.autosaveOn': 'On', 'set.autosaveOff': 'Off', 'set.autosaveInterval': 'Autosave interval (s)',
    'set.defaultMode': 'Default open mode', 'set.defaultModeHint': 'Display mode used for newly opened documents',
    'set.modeRead': 'Read', 'set.modeEdit': 'Edit', 'set.modeSplit': 'Read + Edit',
    'set.ui': 'UI', 'set.showTree': 'Show file tree', 'set.showToc': 'Show outline', 'set.splitReset': 'Reset split ratio',
    'set.signature': 'Signature', 'set.signatureShow': 'Show signature', 'set.signatureName': 'Name',
    'set.signatureEmail': 'Email', 'set.signatureNamePh': 'e.g. Xu Fan', 'set.signatureEmailPh': 'e.g. cfanx@163.com',
    'set.signatureHint': 'Appends the signature and email at the end of the document in reading view; source files are not modified',
    'set.assoc': 'File association', 'set.register': 'Register .md handler', 'set.unregister': 'Remove association',
    'set.clearRecent': 'Clear recent', 'set.about': 'About',
    'about.title': 'About MarkFlow', 'about.version': 'Version {ver}',
    'about.desc': 'Markdown reader & editor for Windows · Built with Electron + CodeMirror 6 + markdown-it',
    'search.title': 'Search in Folder', 'search.placeholder': 'Type keyword to search across files…', 'search.case': 'Case sensitive',
    'search.name': 'Name', 'search.content': 'Content', 'search.empty': 'No results',
    'search.results': '{n} matches',
    'tb.bold': 'Bold', 'tb.italic': 'Italic', 'tb.strike': 'Strikethrough', 'tb.code': 'Inline code', 'tb.link': 'Link',
    'tb.image': 'Image', 'tb.headingUp': 'Heading up', 'tb.headingDown': 'Heading down', 'tb.quote': 'Quote',
    'tb.ul': 'Bullet list', 'tb.ol': 'Numbered list', 'tb.task': 'Task list', 'tb.table': 'Table', 'tb.codeblock': 'Code block', 'tb.hr': 'Divider',
    'view.split': 'Split', 'view.preview': 'Preview', 'view.editor': 'Source',
    'msg.saved': 'Saved', 'msg.autosaved': 'Auto-saved', 'msg.externalChange': 'File modified externally', 'msg.reload': 'Reload', 'msg.ignore': 'Ignore',
    'msg.confirmClose': 'This file has unsaved changes. Close anyway?', 'msg.save': 'Save', 'msg.dontSave': 'Don\'t save', 'msg.cancel': 'Cancel',
    'msg.assocOn': 'File association registered', 'msg.assocOff': 'File association removed', 'msg.about': 'MarkFlow v{ver} · Built with Electron + CodeMirror 6 + markdown-it.',
    'msg.noDir': 'Choose a folder in the file tree first', 'msg.openFail': 'Open failed', 'msg.saveFail': 'Save failed',
    'msg.encodingUpgraded': 'File converted from GBK to UTF-8 on save',
    'msg.autosaveUnnamed': 'Untitled files cannot be auto-saved; save manually first',
    'drop.hint': 'Drop Markdown files here to open',
  },
};

let current = 'zh-CN';

export function t(key, vars) {
  let s = (dict[current] && dict[current][key]) ?? (dict['en'][key]) ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

export function setLang(lang) {
  current = dict[lang] ? lang : 'zh-CN';
  document.documentElement.lang = current;
  applyI18n(document);
}

export function getLang() { return current; }

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const key = el.getAttribute('data-i18n-ph');
    if (key) el.placeholder = t(key);
  });
}
