#pragma once
#include <string>

// Markdown -> RTF 转换（仅依赖标准库 + Windows API）。
// 设计目标：把常见 Markdown 子集渲染成 RTF，交给系统 RichEdit 控件显示，
// 完全不依赖 WebView2 / MSHTML，从而彻底规避「万能五笔激活时拖垮 WebView2」的崩溃。
namespace md2rtf {

// 输入：UTF-8 编码的 Markdown 文本。
// 输出：UTF-16 的 RTF 文档字符串（含 \u 转义以携带中文等字符）。
std::wstring convert(const std::string& markdownUtf8);

} // namespace md2rtf
