# MarkFlow

**MarkFlow** — A Windows Markdown reader/editor with a native File Explorer preview handler. Built with Electron + CodeMirror. The `.md` preview pane uses a COM shell extension (no WebView2, IME-safe).

> 一款基于 Electron 的 Windows Markdown 阅读 / 编辑工具，附带**原生资源管理器预览处理器**：无需打开编辑器，在文件资源管理器的预览窗格里直接看到 `.md` 渲染结果。

## 功能特性

- **三模式布局**：`split`（阅读 + 编辑并排）/ `read`（仅预览）/ `edit`（仅源码），`F2` 循环切换，可在设置中指定默认打开模式
- **实时预览**：编辑区输入即时同步到预览区
- **目录大纲（TOC）**：点击跳转；编辑模式下跳转到源码对应行并高亮
- **扩展语法**：代码块高亮（highlight.js）、任务列表、脚注等
- **署名落款**：在「关于」中配置署名与邮箱，预览末尾自动追加（`mailto:` 可点击），**不写入 `.md` 源文件**
- **文件树 / 多标签 / 设置持久化**，中英双语界面
- **原生预览处理器**（可选组件）：让资源管理器预览窗格直接渲染 `.md`

## 目录结构

```
markflow/
├── main/                 # Electron 主进程（窗口、设置存储、菜单、单实例锁）
├── renderer/             # 渲染进程（CodeMirror 编辑器、预览、设置 / 关于 UI）
│   ├── js/
│   └── css/
├── preview-handler/      # 原生 COM 预览处理器（C++ / MinGW-w64）
│   ├── preview_handler.cpp   # IPreviewHandler 实现
│   ├── md2rtf.cpp            # Markdown → RTF 转换
│   ├── build.sh              # 编译脚本
│   └── dist/                 # 编译产物（不入库）
├── samples/              # 示例文档
├── tests/                # e2e / 功能测试（Playwright）
├── build.js              # 前端资源构建（esbuild）
├── pack.js               # 打包为 Windows 便携版
└── package.json
```

## 安装与运行

### 方式一：下载便携版

从 GitHub Releases 下载 `MarkFlow-*-win32-x64-portable.zip`，解压后直接运行 `MarkFlow.exe`，无需安装。

### 方式二：从源码运行

```bash
npm install
npm start          # 等价于 node build.js && electron .
```

### 打包为便携版

```bash
npm run pack       # node build.js && node pack.js
```

产物位于 `dist/MarkFlow-win32-x64/`，可整体压缩分发（已自动排除 `tests/`、`shots/`、开发冗余文件）。

## 资源管理器预览处理器（可选）

让文件资源管理器的预览窗格直接显示 `.md` 渲染结果，无需启动 MarkFlow。

**设计要点**

- **无 WebView2**：使用原生 RichEdit 渲染，规避 Chromium 与输入法（如万能五笔）的兼容性崩溃
- **输入法安全**：预览窗口显式断开 IME 上下文，输入法无法加载进宿主进程，彻底消除崩溃向量
- 纯 C++，无额外运行时依赖；以 `prevhost.exe` 低完整性代理宿主运行

**构建与注册**（需要 MinGW-w64 工具链）

```bash
cd preview-handler
bash build.sh                       # 生成 dist/*.dll、register.exe 等工具
./dist/register.exe                 # 注册到当前用户（HKCU，无需管理员权限）
```

卸载：

```bash
./dist/register.exe /u
```

> 注册仅写入当前用户配置，不影响系统其他用户。若修改 DLL 或注册表后预览窗格无反应，请重启「文件资源管理器」进程以刷新 Shell 缓存。

## 技术栈

- **Electron** 44（主进程 / 渲染进程）
- **CodeMirror 6**（编辑器）
- **markdown-it** + 插件（预览渲染）、**highlight.js**（代码高亮）
- **预览处理器**：C++ / MinGW-w64，实现 COM `IPreviewHandler` 接口

## 版本历史

- **v0.1.6**（当前）：预览处理器开发、构建与注册流程落地
- **v0.1.4**：署名迁移至「关于」对话框；修复编辑模式下目录跳转失效与空白分栏
- **v0.1.3**：新增署名（落款）功能
- **v0.1.2**：显示模式重构为 `split` / `read` / `edit` 三态；修复 TOC 跳转选择器异常

## 许可证

MIT
