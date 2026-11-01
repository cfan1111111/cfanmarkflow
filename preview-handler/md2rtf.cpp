// md2rtf.cpp — Markdown(UTF-8) -> RTF(UTF-16) 转换器
// 仅依赖标准库与 Windows API（MultiByteToWideChar）。
// 目的：把 Markdown 渲染成 RTF 文本，交给系统 RichEdit 控件显示，
//      完全不依赖 WebView2 / MSHTML，从而彻底规避万能五笔拖垮 WebView2 的崩溃。
#include "md2rtf.h"
#include <windows.h>
#include <string>
#include <vector>
#include <cwchar>

namespace md2rtf {

static std::wstring utf8ToWide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    if (n <= 0) return std::wstring();
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n);
    if (!w.empty() && w[0] == 0xFEFF) w.erase(0, 1); // 去 BOM
    return w;
}

// 单个字符的 RTF 转义。
static std::wstring rtfChar(wchar_t c) {
    switch (c) {
        case L'\\': return L"\\\\";
        case L'{':  return L"\\{";
        case L'}':  return L"\\}";
        case L'\t': return L"\\tab ";
    }
    if (c == L'\r') return L"";
    if (c == L'\n') return L"\\par ";          // 段落内换行（极少用到）
    if (c >= 32 && c < 127) return std::wstring(1, c); // 可打印 ASCII 原样
    if (c < 32) return L"";                       // 其它控制符忽略
    int v = (int)c;
    if (v > 32767) v -= 65536;                     // RTF \u 为有符号 16 位
    return L"\\u" + std::to_wstring(v) + L"?";
}

// 字面文本转义（不解析 Markdown 语法）。
static std::wstring rtfEscape(const std::wstring& s) {
    std::wstring r;
    r.reserve(s.size() * 2);
    for (wchar_t c : s) r += rtfChar(c);
    return r;
}

// 行内语法解析：粗体/斜体/行内代码/链接/图片/删除线/反斜杠转义。
static std::wstring parseInline(const std::wstring& s) {
    std::wstring out;
    size_t i = 0, n = s.size();
    while (i < n) {
        wchar_t c = s[i];

        if (c == L'\\' && i + 1 < n) {            // 转义：\* 等
            out += rtfChar(s[i + 1]);
            i += 2; continue;
        }

        if (c == L'`') {                          // 行内代码 `code`
            size_t j = i;
            while (j < n && s[j] == L'`') j++;
            size_t open = j - i;
            size_t k = j; bool found = false;
            while (k < n) {
                if (s[k] == L'`') {
                    size_t m = k;
                    while (m < n && s[m] == L'`') m++;
                    if (m - k == open) { found = true; break; }
                    k = m;
                } else k++;
            }
            if (found) {
                std::wstring code = s.substr(j, k - j);
                out += L"\\f1\\highlight3 ";
                out += rtfEscape(code);
                out += L"\\highlight0\\f0 ";
                i = k + open;
                continue;
            }
            out += rtfChar(c); i++; continue;
        }

        if (c == L'!') {                          // 图片 ![alt](url)
            if (i + 1 < n && s[i + 1] == L'[') {
                size_t close = s.find(L']', i + 2);
                if (close != std::wstring::npos && close + 1 < n && s[close + 1] == L'(') {
                    size_t urle = s.find(L')', close + 2);
                    if (urle != std::wstring::npos) {
                        std::wstring alt = s.substr(i + 2, close - (i + 2));
                        out += L"[" + rtfEscape(alt) + L"]";
                        i = urle + 1; continue;
                    }
                }
            }
            out += rtfChar(c); i++; continue;
        }

        if (c == L'[') {                          // 链接 [text](url)
            size_t close = s.find(L']', i + 1);
            if (close != std::wstring::npos && close + 1 < n && s[close + 1] == L'(') {
                size_t urle = s.find(L')', close + 2);
                if (urle != std::wstring::npos) {
                    std::wstring text = s.substr(i + 1, close - (i + 1));
                    out += L"{\\ul\\cf2 " + parseInline(text) + L"\\cf1\\ul0}";
                    i = urle + 1; continue;
                }
            }
            out += rtfChar(c); i++; continue;
        }

        if (c == L'*' || c == L'_') {             // 强调 * _ （** 粗体 / * 斜体）
            size_t j = i;
            while (j < n && s[j] == c) j++;
            size_t len = j - i;
            size_t delim = (len >= 2) ? 2 : 1;
            size_t k = j; bool found = false;
            while (k < n) {
                if (s[k] == c) {
                    size_t m = k;
                    while (m < n && s[m] == c) m++;
                    if (m - k == delim) { found = true; break; }
                    k = m;
                } else if (s[k] == L'\n') break;
                else k++;
            }
            if (found) {
                std::wstring inner = s.substr(j, k - j);
                if (delim == 2) out += L"{\\b " + parseInline(inner) + L"\\b0}";
                else            out += L"{\\i " + parseInline(inner) + L"\\i0}";
                i = k + delim;
                continue;
            }
            out += rtfChar(c); i++; continue;
        }

        if (c == L'~' && i + 1 < n && s[i + 1] == L'~') {  // 删除线 ~~
            size_t k = i + 2; bool found = false;
            while (k < n) {
                if (s[k] == L'~' && k + 1 < n && s[k + 1] == L'~') { found = true; break; }
                if (s[k] == L'\n') break;
                k++;
            }
            if (found) {
                std::wstring inner = s.substr(i + 2, k - (i + 2));
                out += L"{\\strike " + parseInline(inner) + L"\\strike0}";
                i = k + 2; continue;
            }
            out += rtfChar(c); i++; continue;
        }

        out += rtfChar(c);
        i++;
    }
    return out;
}

static bool isListMarker(const std::wstring& l) {
    size_t i = 0;
    while (i < l.size() && (l[i] == L' ' || l[i] == L'\t')) i++;
    if (i >= l.size()) return false;
    if (l[i] == L'-' || l[i] == L'*' || l[i] == L'+')
        return (i + 1 < l.size() && l[i + 1] == L' ');
    size_t j = i;
    while (j < l.size() && iswdigit((wint_t)l[j])) j++;
    if (j > i && j < l.size() && (l[j] == L'.' || l[j] == L')') && j + 1 < l.size() && l[j + 1] == L' ')
        return true;
    return false;
}

static void parseListMarker(const std::wstring& l, std::wstring& marker, std::wstring& content) {
    size_t i = 0;
    while (i < l.size() && (l[i] == L' ' || l[i] == L'\t')) i++;
    if (l[i] == L'-' || l[i] == L'*' || l[i] == L'+') {
        marker = std::wstring(1, l[i]);
        size_t st = i + 1; if (st < l.size() && l[st] == L' ') st++;
        content = l.substr(st);
    } else {
        size_t j = i;
        while (j < l.size() && iswdigit((wint_t)l[j])) j++;
        marker = l.substr(i, j - i + 1); // 含 . 或 )
        size_t st = j + 1; while (st < l.size() && l[st] == L' ') st++;
        content = l.substr(st);
    }
}

static const wchar_t* RTF_HEADER =
    L"{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0"
    L"{\\fonttbl{\\f0\\fnil\\fcharset0 Segoe UI;}{\\f1\\fnil\\fcharset0 Consolas;}}"
    L"{\\colortbl;\\red33\\green37\\blue41;\\red0\\green90\\blue158;\\red238\\green238\\blue238;}"
    L"\\viewkind4\\uc1 ";

std::wstring convert(const std::string& markdownUtf8) {
    std::wstring w = utf8ToWide(markdownUtf8);

    std::vector<std::wstring> lines;
    std::wstring cur;
    for (wchar_t c : w) {
        if (c == L'\n') { lines.push_back(cur); cur.clear(); }
        else if (c != L'\r') cur.push_back(c);
    }
    if (!cur.empty()) lines.push_back(cur);

    std::wstring out = RTF_HEADER;
    size_t i = 0, N = lines.size();
    while (i < N) {
        const std::wstring& line = lines[i];
        if (line.empty()) { i++; continue; }

        // 围栏代码块 ``` 或 ~~~
        if (line.size() >= 3 && (line.substr(0, 3) == L"```" || line.substr(0, 3) == L"~~~")) {
            wchar_t fence = line[0];
            size_t fenceLen = 0; while (fenceLen < line.size() && line[fenceLen] == fence) fenceLen++;
            i++;
            std::wstring code;
            while (i < N) {
                const std::wstring& l = lines[i];
                size_t fl = 0; while (fl < l.size() && l[fl] == fence) fl++;
                if (fl >= 3 && (l.empty() || fl == l.size())) { i++; break; }
                code += l; code += L"\n";
                i++;
            }
            out += L"\\pard\\sa120\\sl240\\slmult1\\f1\\highlight3\\cf1 ";
            out += rtfEscape(code);
            out += L"\\highlight0\\f0\\par";
            continue;
        }

        // 标题 # ~ ######
        if (line[0] == L'#') {
            size_t h = 0; while (h < line.size() && line[h] == L'#' && h < 6) h++;
            if (h >= 1 && (h == line.size() || line[h] == L' ')) {
                std::wstring text = (h < line.size()) ? line.substr(h + 1) : L"";
                int fs = (h == 1 ? 30 : h == 2 ? 26 : h == 3 ? 24 : h == 4 ? 22 : h == 5 ? 21 : 20);
                out += L"\\pard\\sa160\\sl" + std::to_wstring(fs * 8) + L"\\slmult1\\b\\fs" +
                       std::to_wstring(fs) + L"\\cf1\\f0 ";
                out += parseInline(text);
                out += L"\\b0\\par";
                i++; continue;
            }
        }

        // 分隔线 --- *** ___
        {
            bool hr = true; size_t cnt = 0;
            for (wchar_t c : line) {
                if (c == L' ' || c == L'\t') continue;
                if (c == L'-' || c == L'*' || c == L'_') cnt++;
                else { hr = false; break; }
            }
            if (hr && cnt >= 3) {
                out += L"\\pard\\sa80\\sl1\\brdrb\\brdrs\\brdrw15\\par";
                i++; continue;
            }
        }

        // 引用 >
        if (line[0] == L'>') {
            std::wstring q;
            while (i < N && !lines[i].empty() && lines[i][0] == L'>') {
                std::wstring l = lines[i];
                size_t st = 1; if (st < l.size() && l[st] == L' ') st++;
                if (!q.empty()) q += L" ";
                q += l.substr(st);
                i++;
            }
            out += L"\\pard\\sa120\\sl240\\slmult1\\li480\\ri240\\i\\cf1\\f0 ";
            out += parseInline(q);
            out += L"\\i0\\par";
            continue;
        }

        // 列表
        if (isListMarker(line)) {
            while (i < N && isListMarker(lines[i])) {
                std::wstring marker, content;
                parseListMarker(lines[i], marker, content);
                std::wstring bullet = (marker == L"-" || marker == L"*" || marker == L"+")
                                      ? std::wstring(L"\\bullet\t") : (marker + L"\t");
                out += L"\\pard\\sa60\\sl240\\slmult1\\li480\\fi-360\\cf1\\f0 ";
                out += bullet;
                out += parseInline(content);
                out += L"\\par";
                i++;
            }
            continue;
        }

        // 段落（聚合到空行或特殊行）
        std::wstring para;
        while (i < N && !lines[i].empty() && lines[i][0] != L'#' && lines[i][0] != L'>' &&
               !isListMarker(lines[i]) &&
               !(lines[i].size() >= 3 && (lines[i].substr(0, 3) == L"```" || lines[i].substr(0, 3) == L"~~~"))) {
            if (!para.empty()) para += L" ";
            para += lines[i];
            i++;
        }
        // 兜底：当前行未被上面任何分支识别时（例如 "#include <x>" —— '#' 后无空格，
        // 标题分支不匹配；">>>"、"#foo" 等同理），上面的 while 不会推进 i，
        // 外层循环会永远停在这一行形成死循环。
        // 因此这里强制按普通段落消费一行，保证解析一定前进。
        if (para.empty() && i < N) {
            para = lines[i];
            i++;
        }
        if (!para.empty()) {
            out += L"\\pard\\sa120\\sl240\\slmult1\\cf1\\f0\\fs22 ";
            out += parseInline(para);
            out += L"\\par";
        }
    }

    out += L"}";
    return out;
}

} // namespace md2rtf
