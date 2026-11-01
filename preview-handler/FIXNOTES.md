# MarkFlow 原生预览处理器 — 排查与修复记录

> 目标：让 `.md` 文件在文件资源管理器预览窗格中直接渲染，且**不被万能五笔输入法
> （wnTSF.ime）搞崩**（原 PowerToys 的 WebView2 预览器每逢五笔必崩）。
> 方案：自研 COM Shell 预览处理器（`IPreviewHandler`），MinGW-w64 编译，
> 内容用原生 RichEdit（RICHEDIT50W）渲染，**全程无 WebView2**。

## 一、崩溃根因与修复（按发现顺序）

### 1. `IPreviewHandler` vtable 顺序错误（致命，prevhost 0xC0000005）

`shobjidl.idl` 中 `IPreviewHandler : IUnknown` 的真实顺序是：

```
SetWindow, SetRect, DoPreview, Unload, SetFocus, QueryFocus, TranslateAccelerator
```

（**不继承 IOleWindow**——SetFocus/QueryFocus 在最后三个槽位）。
曾把 SetFocus/QueryFocus/TranslateAccelerator 提前声明，宿主调 `DoPreview()`（槽 5）
时落到我们的 `QueryFocus(HWND*)` 上，往垃圾指针写值 → prevhost 崩溃。
WER 事件日志 + `nm` 符号表把崩溃偏移 `0x303cc` 精确定位到 `QueryFocus` 才确认。

**修复**：`preview_handler.cpp` 与 `test_host.cpp` 的接口声明与 IDL 逐字一致；
`test_host.exe -nogui` 现在会依次调全部 7 个方法做回归。

### 2. prevhost 低完整性 → 文件日志写不进去

`prevhost.exe` 以 **Low（0x1000）** 完整性运行，`%TEMP%` 不可写，日志全丢。
**修复**：日志三级回退——文件 → `HKCU\Software\AppDataLow\MarkFlowPreview`
（低完整性唯一可写注册表位）→ `OutputDebugStringW`；另在 `DllMain` 记录
宿主持久性与完整性。此后所有诊断才成为可能。

### 3. `IPreviewHandlerVisuals` IID 错误（非致命）

代码注释里的 `{5CFB5C1D-...}` 是错的，Explorer 实际 QI 的是
`{196BF9A5-B346-4EF0-AA1E-5DCDB76768B1}`；且 `SetFont` 签名为
`(const LOGFONTW*)`（单参）。该接口可选，**已从 QI 中撤下**，避免 vtable 风险。

### 4. md2rtf 段落兜底死循环（大文件卡死）

遇到无法识别的行（如 `#include <windows.h>`——`#` 后无空格，标题分支不匹配），
段落聚合 while 不推进 `i`，外层循环**永远停在这一行**。表现：43KB 的 .md
（或任何含 `#` 开无空格行的文件）预览卡死。
**修复**：兜底分支强制按普通段落消费一行，保证解析一定前进。

### 5. Explorer 进程缓存"无预览器"（表现为间歇性无预览）

改注册表/重建 DLL 后，**已运行的 Explorer 进程**仍按旧缓存判断"该扩展名无预览器"，
连 prevhost 都不生成。**修复**：`taskkill /F /IM explorer.exe` 让 shell 自动重启，
新进程读到新注册表即恢复。这是"明明注册好了却不预览"的最常见假象。

## 二、低完整性嵌入的关键认知

- 宿主传给 `SetWindow` 的父窗口类名是 `Shell Preview Extension Host Previewer`，
  且**创建在 prevhost 自己进程内**（ownerPid == selfPid）。这正是低完整性预览
  处理器能嵌入窗格的原因：父子同进程同完整性，UIPI 不拦。
- Explorer 随后把这个窗口**重父化**进自己的窗格（UIPI 允许高完整性进程
  SetParent 低完整性窗口，反之不行）。实测窗口链 8 层：
  ```
  CabinetWClass > ShellTabWindowClass > DUIViewWndClassName > DirectUIHWND
    > CtrlNotifySink > Shell Preview Extension Host
    > Shell Preview Extension Host Previewer > RICHEDIT50W
  ```
- UIPI 实测（`iltest.exe`）：低完整性进程不能给高完整性窗口当子窗口
  （CreateWindowEx/SetParent 均 err=5），但可以建顶层窗口、可以
  IsWindow/GetClassName 高完整性窗口。

## 三、注册表要点（register.exe 全部自动完成）

| 键 | 值 |
|---|---|
| `HKCU\Software\Classes\.md\ShellEx\{8895b1c6-...}` | 我们的 CLSID |
| `HKCU\Software\Classes\CLSID\{我们的CLSID}\AppID` | `{6D2B5079-...}`（预览代理宿主） |
| `HKCU\Software\Classes\CLSID\{我们的CLSID}\InprocServer32` | DLL 全路径 |
| `...\InprocServer32\ThreadingModel` | `Apartment` |

**`AppID` 值是指纹性的**：缺了它 COM 不会把处理器激活到 prevhost 代理，
Explorer 要么进程内加载要么直接不预览。系统级
`HKLM\...\AppID\{6D2B5079-...}\DllSurrogate=C:\Windows\system32\prevhost.exe`
Windows 自带，代码里做了兜底补写。

## 四、IME（万能五笔）验证结论 —— 设计层面已根除，无需用户实测

`imeprobe.exe`（真实预览窗格输入注入 + 进程模块检测）实测：

- 预览窗格获得焦点后 IME 窗口（class `IME`）挂到 RichEdit 上、MSCTF/IMM32 在
  prevhost 内加载，但 **wnTSF.ime 从不加载进 prevhost**；
- 点击 + 连续按键（中文键盘布局激活）→ **prevhost 全程存活**；
- 原因不是"恰好停在英文模式"，而是**设计使然**：`createEdit()` 两条路径
  （子窗口 / 顶层兜底）在创建控件后都执行了
  ```cpp
  ImmAssociateContext(m_edit, nullptr);   // 彻底断开输入法与预览窗口的关联
  ```
  输入法上下文被摘除后，任何激活的 IME（含万能五笔）都无法向预览窗格组字，
  IME DLL 根本不会被拉进 prevhost。

**架构性结论（双重根除）**：
1. 渲染用原生 RichEdit，**全程无 WebView2**——原崩溃载体（Chromium 的 TSF
   集成与 wnTSF.ime 冲突）不复存在；
2. 预览窗口显式断开 IME 上下文——输入法连加载入口都没有。

原 PowerToys 预览器"逢五笔必崩"的场景在本方案下**结构上不可能复现**，
且行为与系统内置 TXT/RTF 预览器一致（只读、不接受输入）。

## 五、构建与工具链

- 工具链：`D:/workbuddy/2026-10-23-08-57-29/toolchain/mingw64`（GCC 14.2.0 msvcrt）
- 一键构建：`preview-handler/build.sh`（DLL + register + test_host + md2rtf_test + imeprobe）
- 注册/卸载：`dist/register.exe` / `dist/register.exe /u`（HKCU，无需管理员）
- 冒烟：`dist/test_host.exe <file.md> -nogui`（vtable 全槽位回归）
- IME 压测：`dist/imeprobe.exe wubi`（另支持 list/deep/selfro 诊断模式）
- 端到端验证脚本：`D:/workbuddy/2026-10-23-08-57-29/exp16.ps1`
  （开新窗口 → 显式开预览窗格 → 选中文件 → 读日志 → 截图）

## 六、已知遗留

1. **Explorer 进程缓存**：改注册表或换 DLL 后若预览不出现，先杀 explorer 重启。
2. **IME 最后一公里**：wnTSF.ime 的真实组字注入待用户手动验证（见上）。
3. `DllRegisterServer` 里 `AutomaticallyPreviewUntrustedFiles` 相关写入已无必要
   （该值当年为调试手工删过，代码未再写）。
4. 尚未接入 MarkFlow 打包流程（`pack.js`）：首次运行 DllRegisterServer、
   卸载时 DllUnregisterServer。
