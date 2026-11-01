// preview_handler.cpp — MarkFlow 原生 Markdown 预览处理器（COM Shell 扩展）
//
// 设计要点：
//  1. 不依赖 WebView2 / MSHTML。使用系统自带的 RichEdit 控件（msftedit.dll）渲染。
//  2. 创建预览窗口后显式 ImmAssociateContext(hwnd, NULL) 断开 IME 关联，
//     万能五笔等任何输入法都不会再作用于预览窗格 —— 彻底规避之前的崩溃。
//  3. 仅依赖系统 DLL，用 -static 编出自包含 DLL，被 Explorer 加载最稳。
//  4. 全链路写诊断日志到 %TEMP%\MarkFlowPreview.log，
//     便于定位「Explorer 里无预览」到底卡在哪一步（加载/Initialize/SetWindow/DoPreview）。
//
// 编译（见 build.sh）：
//   g++ -shared -static -static-libgcc -static-libstdc++ -Wl,--kill-at
//      -o MarkFlowPreviewHandler.dll preview_handler.cpp md2rtf.cpp ...

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>   // IUnknown / IClassFactory / CLSID
#include <imm.h>
#include <string>
#include <vector>
#include <cstdio>
#include <cstdarg>
#include "md2rtf.h"

// ---------------------------------------------------------------------------
//  接口自声明（严格对齐真实 Windows SDK 的方法顺序与 IID）
//
//  为什么不用 MinGW 的 <shobjidl.h>：
//    1. MinGW 的 shobjidl.h 里根本没有 IInitializeWithFile；
//    2. MinGW 的 IPreviewHandlerVisuals 的 IID 是
//       {196BF9A5-B346-4EF0-AA1E-5DCDB76768B1}，
//       而真实 SDK 是 {5CFB5C1D-0839-4E14-8E95-1437E9FBBB69}；
//    3. MinGW 的 IPreviewHandlerVisuals::SetFont 少了第 1 个参数（LPCWSTR）。
//    以上任一偏差都会让 Explorer 按真实 SDK 的 vtable 调用时槽位错位，
//    表现为「资源管理器预览窗格无预览」。
// ---------------------------------------------------------------------------

// 以下三个接口的方法顺序必须与 Windows SDK 的 shobjidl.idl 逐字一致，
// 否则宿主按真实虚表槽位调用时会落到错误的方法上。
// 本次「无预览」的根因就是 IPreviewHandler 的顺序写错：
// 曾把 SetFocus/QueryFocus/TranslateAccelerator 插在 SetRect/DoPreview/Unload
// 之前，导致宿主调 DoPreview（槽5）落到我们的 QueryFocus(HWND*) 上，
// 往一个未初始化指针写值 -> prevhost.exe 以 0xC0000005 崩溃。
struct IPreviewHandler : public IUnknown {
    STDMETHOD(SetWindow)(HWND hwnd, const RECT* prc) = 0;
    STDMETHOD(SetRect)(const RECT* prc) = 0;
    STDMETHOD(DoPreview)(void) = 0;
    STDMETHOD(Unload)(void) = 0;
    STDMETHOD(SetFocus)(void) = 0;
    STDMETHOD(QueryFocus)(HWND* phwnd) = 0;
    STDMETHOD(TranslateAccelerator)(MSG* pmsg) = 0;
};

// IOleWindow 直接用系统 oleidl.h 提供的版本（其 IID {00000114-0000-0000-C000-000000000046}
// 即真实 SDK 取值，方法顺序 GetWindow/ContextSensitiveHelp 亦一致）。

struct IInitializeWithFile : public IUnknown {
    STDMETHOD(Initialize)(LPCWSTR pszFilePath, DWORD grfMode) = 0;
};

// IPreviewHandlerVisuals（可选接口）：
//   宿主确实会 QI 它，IID 是 {196BF9A5-B346-4EF0-AA1E-5DCDB76768B1}
//   （曾误以为是 {5CFB5C1D-...}，导致 QI 永远失败）。
//   实测：QI 返回 E_NOINTERFACE 后宿主照常继续 SetRect/DoPreview，
//   因此该接口是纯可选的。且 MSDN 显示其 SetFont 只有
//   (const LOGFONTW*) 一个参数，与我们此处的声明不同，
//   在没有完全确认虚表前暂不对外暴露（返回 E_NOINTERFACE），
//   以免重蹈 IPreviewHandler 顺序错误导致 prevhost 崩溃的覆辙。
//   待预览主链路稳定后，再按确认无误的虚表开放以支持暗色背景。
struct IPreviewHandlerVisuals : public IUnknown {
    STDMETHOD(SetBackgroundColor)(COLORREF color) = 0;
    STDMETHOD(SetFont)(const LOGFONTW* plf) = 0;
    STDMETHOD(SetTextColor)(COLORREF color) = 0;
};
static const IID IID_IPreviewHandlerVisuals_NOT_EXPOSED = {0x196BF9A5,0xB346,0x4EF0,{0xAA,0x1E,0x5D,0xCD,0xB7,0x67,0x68,0xB1}};

struct IObjectWithSite : public IUnknown {
    STDMETHOD(SetSite)(IUnknown* pUnkSite) = 0;
    STDMETHOD(GetSite)(REFIID riid, void** ppvSite) = 0;
};

// ---- 接口 IID（真实 Windows SDK 取值） ----
static const IID IID_IPreviewHandler        = {0x8895B1C6,0xB41F,0x4C1C,{0xA5,0x62,0x0D,0x56,0x42,0x50,0x83,0x6F}};
static const IID IID_IInitializeWithFile   = {0xB7D14566,0x0509,0x4CCE,{0xA7,0x1F,0x0A,0x55,0x42,0x33,0xBD,0x9B}};
static const IID IID_IObjectWithSite       = {0xFC4801A3,0x2BA9,0x11CF,{0xA2,0x29,0x00,0xAA,0x00,0x3D,0x73,0x52}};

// 仅我们自己的类 CLSID
static const CLSID CLSID_MarkFlowPreviewHandler = {0x6F3A8C2B,0x1E4D,0x4B7A,{0x9C,0x5E,0x2D,0x8F,0x1A,0x0B,0x3C,0x4E}};

// 预览挂载槽 GUID（与 IPreviewHandler 的 IID 相同，这是 Shell 的约定）
static const wchar_t* PREVIEW_SLOT = L"{8895B1C6-B41F-4C1C-A562-0D564250836F}";

// RichEdit 相关常量（避免依赖 richedit.h）
#ifndef EM_SETTEXTEX
#define EM_SETTEXTEX (WM_USER + 97)
#endif
#ifndef EM_SETBKGNDCOLOR
#define EM_SETBKGNDCOLOR (WM_USER + 67)
#endif
#ifndef EM_SETMARGINS
#define EM_SETMARGINS (WM_USER + 21)
#endif
#ifndef EM_SETCHARFORMAT
#define EM_SETCHARFORMAT (WM_USER + 68)
#endif
#ifndef EC_LEFTMARGIN
#define EC_LEFTMARGIN 0x0001
#define EC_RIGHTMARGIN 0x0002
#endif
typedef struct _SETTEXTEX {
    DWORD flags;
    UINT  codepage;
} SETTEXTEX;
#define ST_RTF 0x0004

// ---- 全局 ----
static HINSTANCE g_hInstance = nullptr;
static LONG g_objCount = 0;
static LONG g_lockCount = 0;

// ================= 诊断日志 =================
// 注意：这里刻意不使用 printf 风格格式化拼接。
// 实测 MinGW 的 _vsnwprintf_s / _snprintf_s 在处理「含非 ASCII（中文）的宽字符串」时
// 会静默失败，导致整行日志丢失（表现为「某方法明明执行了，日志却没有」）。
// 因此改为：手工拼 std::wstring -> WideCharToMultiByte(CP_UTF8) -> 直接写字节。
// 附带好处：日志为 UTF-8，任何编辑器都能正常显示中文路径。
static std::string toUtf8(const std::wstring& s) {
    if (s.empty()) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0, nullptr, nullptr);
    if (n <= 0) return std::string();
    std::string out((size_t)n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, s.c_str(), (int)s.size(), &out[0], n, nullptr, nullptr);
    return out;
}

static std::wstring wstr(const wchar_t* s) {
    return (s && *s) ? std::wstring(s) : std::wstring(L"(null)");
}

static std::wstring wnum(long long v) {
    wchar_t b[32];
    swprintf(b, 32, L"%lld", v);
    return std::wstring(b);
}

static std::wstring whex(unsigned long v) {
    wchar_t b[32];
    swprintf(b, 32, L"0x%08X", v);
    return std::wstring(b);
}

static std::wstring wptr(const void* p) {
    wchar_t b[32];
    swprintf(b, 32, L"0x%p", p);
    return std::wstring(b);
}

// 逐级创建父目录（低完整性宿主创建不了 %TEMP%\Low，但 medium 宿主可以；
// 已有目录则直接返回成功）。
static bool ensureDir(const std::wstring& dir) {
    if (dir.empty()) return false;
    if (dir.size() <= 3) return false; // "C:\" 之类根目录，无需创建
    DWORD a = GetFileAttributesW(dir.c_str());
    if (a != INVALID_FILE_ATTRIBUTES) return (a & FILE_ATTRIBUTE_DIRECTORY) != 0;
    size_t pos = dir.find_last_of(L"\\/");
    if (pos == std::wstring::npos) return false;
    if (!ensureDir(dir.substr(0, pos))) return false;
    if (CreateDirectoryW(dir.c_str(), nullptr)) return true;
    return GetLastError() == ERROR_ALREADY_EXISTS;
}

// 低完整性宿主（prevhost.exe 以 Low 完整性运行）写不了普通 %TEMP%
// （该目录带有 Medium 强制标签，低完整性进程写入被 UIPI 拒绝），
// 因此按优先级尝试多个可写位置，第一个能创建文件的即为日志路径。
// 全部失败时返回空串，由 logw() 退化到 HKCU\Software\AppDataLow
// —— 那是微软为低完整性进程指定的唯一可写注册表位置。
static std::wstring logPath() {
    static std::wstring cached;
    static bool tried = false;
    if (tried) return cached;
    tried = true;

    wchar_t tmp[MAX_PATH];
    DWORD n = GetTempPathW(MAX_PATH, tmp);
    std::wstring base = (n && n <= MAX_PATH) ? std::wstring(tmp, n) : std::wstring(L"C:\\Windows\\Temp\\");
    if (!base.empty() && base.back() != L'\\') base += L'\\';

    // 候选路径（按优先级）。%TEMP%\Low 与 LocalLow 是低完整性进程的传统可写区，
    // 但它们平时不存在，需先创建父目录。
    std::wstring cands[8];
    int nc = 0;
    cands[nc++] = base + L"MarkFlowPreview.log";
    cands[nc++] = base + L"Low\\MarkFlowPreview.log";
    wchar_t lad[MAX_PATH];
    DWORD ln = GetEnvironmentVariableW(L"LOCALAPPDATA", lad, MAX_PATH);
    if (ln && ln < MAX_PATH) {
        std::wstring la(lad, ln);
        if (!la.empty() && la.back() != L'\\') la += L'\\';
        cands[nc++] = la + L"LocalLow\\Temp\\MarkFlowPreview.log";
        cands[nc++] = la + L"LocalLow\\MarkFlowPreview.log";
    }
    wchar_t wr[MAX_PATH];
    DWORD wn = GetWindowsDirectoryW(wr, MAX_PATH);
    if (wn && wn < MAX_PATH) {
        std::wstring win(wr, wn);
        if (!win.empty() && win.back() != L'\\') win += L'\\';
        cands[nc++] = win + L"Temp\\MarkFlowPreview.log";
    }

    for (int i = 0; i < nc; i++) {
        if (cands[i].empty()) continue;
        size_t pos = cands[i].find_last_of(L"\\/");
        if (pos != std::wstring::npos) ensureDir(cands[i].substr(0, pos));
        HANDLE h = CreateFileW(cands[i].c_str(), FILE_APPEND_DATA,
                               FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                               OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h != INVALID_HANDLE_VALUE) { CloseHandle(h); cached = cands[i]; return cached; }
    }
    return cached; // 空串 -> 走注册表兜底
}

// 注册表兜底日志：低完整性进程也能写 HKCU\Software\AppDataLow
// （该键带有 Low 强制标签，medium/low 均可写，只是低进程读不了高对象）。
// 采用「读出旧值 -> 追加 -> 写回」，超过 48KB 丢弃头部，防止无限增长。
static void logReg(const std::string& line) {
    HKEY hk = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\AppDataLow\\MarkFlowPreview",
                        0, nullptr, REG_OPTION_NON_VOLATILE,
                        KEY_READ | KEY_WRITE, nullptr, &hk, nullptr) != ERROR_SUCCESS)
        return;
    std::string existing;
    DWORD type = 0, sz = 0;
    if (RegQueryValueExA(hk, "Log", nullptr, &type, nullptr, &sz) == ERROR_SUCCESS &&
        type == REG_SZ && sz > 0 && sz < 65536) {
        existing.resize(sz);
        if (RegQueryValueExA(hk, "Log", nullptr, &type, (BYTE*)&existing[0], &sz) == ERROR_SUCCESS)
            existing.resize(sz);
        else existing.clear();
        while (!existing.empty() && existing.back() == '\0') existing.pop_back();
    }
    existing += line;
    if (existing.size() > 49152) existing.erase(0, existing.size() - 49152);
    RegSetValueExA(hk, "Log", 0, REG_SZ, (const BYTE*)existing.c_str(),
                   (DWORD)existing.size() + 1);
    RegCloseKey(hk);
}

static void logw(const std::wstring& msg) {
    SYSTEMTIME st; GetLocalTime(&st);
    wchar_t head[96];
    swprintf(head, 96,
        L"%04u-%02u-%02u %02u:%02u:%02u.%03u [pid %lu tid %lu] ",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds,
        (unsigned long)GetCurrentProcessId(), (unsigned long)GetCurrentThreadId());
    std::wstring full = std::wstring(head) + msg + L"\r\n";
    std::string bytes = toUtf8(full);
    if (bytes.empty()) return;

    // 同时投递到 OutputDebugString：任何完整性级别的进程都能发，
    // 用 DebugView 类工具即可实时看到宿主内部发生了什么（不依赖任何可写位置）。
    OutputDebugStringW(full.c_str());

    const std::wstring& p = logPath();
    if (!p.empty()) {
        HANDLE h = CreateFileW(p.c_str(), FILE_APPEND_DATA,
                               FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                               OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h != INVALID_HANDLE_VALUE) {
            DWORD wr = 0;
            WriteFile(h, bytes.data(), (DWORD)bytes.size(), &wr, nullptr);
            CloseHandle(h);
            return;
        }
    }
    logReg(bytes); // 文件写不出去（典型：prevhost 低完整性）-> 注册表兜底
}

static std::wstring hrStr(HRESULT hr) {
    return whex((unsigned long)hr);
}

// 宽字符 -> ANSI（CP_ACP）。RTF 控制流本身是 ASCII，中文由 \uN 转义携带，
// 因此窄化后仍是无损的 RTF 文本，可直接交给 EM_SETTEXTEX(ST_RTF)。
static std::string wideToAnsi(const std::wstring& w) {
    if (w.empty()) return std::string();
    int n = WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    if (n <= 0) return std::string();
    std::string out((size_t)n, '\0');
    WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.size(), &out[0], n, nullptr, nullptr);
    return out;
}

// 路径兜底：CreateFileW 不接受相对路径，这里统一转成绝对路径。
static std::wstring fullPath(const std::wstring& p) {
    if (p.empty()) return p;
    wchar_t buf[MAX_PATH * 4];
    DWORD n = GetFullPathNameW(p.c_str(), (DWORD)(sizeof(buf) / sizeof(buf[0])), buf, nullptr);
    if (n > 0 && n < sizeof(buf) / sizeof(buf[0])) return std::wstring(buf, n);
    return p;
}

// 读取文件（UTF-8 字节）并截断到 8MB，避免超大文件卡顿
static std::string readFileUtf8(LPCWSTR path) {
    // CreateFileW 不接受相对路径，先转绝对路径
    std::wstring abs = fullPath(path ? path : L"");
    const wchar_t* usePath = abs.empty() ? path : abs.c_str();
    HANDLE h = CreateFileW(usePath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
        logw(std::wstring(L"readFileUtf8: CreateFileW failed, err=") +
             wnum((long long)GetLastError()) + L" path=" + wstr(usePath));
        return std::string();
    }
    DWORD hi = 0;
    DWORD lo = GetFileSize(h, &hi);
    if (lo == INVALID_FILE_SIZE) { CloseHandle(h); return std::string(); }
    size_t total = ((size_t)hi << 32) | lo;
    const size_t cap = 8 * 1024 * 1024;
    if (total > cap) total = cap;
    std::string buf(total, '\0');
    DWORD rd = 0;
    if (!ReadFile(h, &buf[0], (DWORD)total, &rd, nullptr)) rd = 0;
    CloseHandle(h);
    buf.resize(rd);
    logw(std::wstring(L"readFileUtf8: ") + wstr(path) + L" -> " +
         wnum((long long)buf.size()) + L" bytes");
    return buf;
}

static std::wstring utf8ToWide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    if (n <= 0) return std::wstring();
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n);
    if (!w.empty() && w[0] == 0xFEFF) w.erase(0, 1); // 去 BOM
    return w;
}

static std::wstring GuidToWString(REFGUID g) {
    wchar_t buf[40];
    swprintf(buf, 40, L"{%08X-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}",
             g.Data1, g.Data2, g.Data3, g.Data4[0], g.Data4[1], g.Data4[2],
             g.Data4[3], g.Data4[4], g.Data4[5], g.Data4[6], g.Data4[7]);
    return std::wstring(buf);
}

// ================= 预览处理器 =================
class PreviewHandler : public IPreviewHandler,
                      public IOleWindow,
                      public IInitializeWithFile,
                      public IPreviewHandlerVisuals,
                      public IObjectWithSite {
public:
    PreviewHandler()
        : m_ref(1), m_parent(nullptr), m_edit(nullptr), m_bg(RGB(255,255,255)),
          m_text(RGB(33,37,41)), m_site(nullptr), m_inited(false), m_windowed(false),
          m_oleInited(false), m_oleThread(0), m_plainMode(false) {
        SetRectEmpty(&m_rc);
        InterlockedIncrement(&g_objCount);
        logw(L"[ctor] PreviewHandler created");
    }
    virtual ~PreviewHandler() {
        destroyEdit();
        if (m_site) m_site->Release();
        if (m_oleInited && GetCurrentThreadId() == m_oleThread) OleUninitialize();
        InterlockedDecrement(&g_objCount);
        logw(L"[dtor] PreviewHandler destroyed");
    }

    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        logw(std::wstring(L"[QI] riid=") + GuidToWString(riid));
        if (riid == IID_IUnknown)                  *ppv = static_cast<IPreviewHandler*>(this);
        else if (riid == IID_IPreviewHandler)      *ppv = static_cast<IPreviewHandler*>(this);
        else if (riid == IID_IOleWindow)           *ppv = static_cast<IOleWindow*>(this);
        else if (riid == IID_IInitializeWithFile)   *ppv = static_cast<IInitializeWithFile*>(this);
        else if (riid == IID_IObjectWithSite)      *ppv = static_cast<IObjectWithSite*>(this);
        // IPreviewHandlerVisuals 暂不暴露（可选接口，宿主 QI 失败不影响预览）
        else return E_NOINTERFACE;
        AddRef();
        return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&m_ref); }
    STDMETHODIMP_(ULONG) Release() override {
        ULONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return r;
    }

    // IInitializeWithFile
    STDMETHODIMP Initialize(LPCWSTR pszFilePath, DWORD grfMode) override {
        if (!pszFilePath) return E_INVALIDARG;
        m_file = pszFilePath;
        m_md = readFileUtf8(pszFilePath);
        m_inited = true;
        logw(std::wstring(L"[Initialize] file=") + wstr(pszFilePath) +
             L" mode=" + whex((unsigned long)grfMode) +
             L" bytes=" + wnum((long long)m_md.size()));
        return S_OK;
    }

    // IOleWindow
    STDMETHODIMP GetWindow(HWND* phwnd) override {
        if (!phwnd) return E_POINTER;
        *phwnd = m_edit;
        logw(std::wstring(L"[GetWindow] -> ") + wptr((void*)m_edit));
        return m_edit ? S_OK : E_FAIL;
    }
    STDMETHODIMP ContextSensitiveHelp(BOOL) override { return S_OK; }

    // IPreviewHandler
    STDMETHODIMP SetWindow(HWND hwnd, const RECT* prc) override {
        m_parent = hwnd;
        if (prc) m_rc = *prc;
        logw(std::wstring(L"[SetWindow] parent=") + wptr((void*)hwnd) +
             L" rect=(" + wnum(m_rc.left) + L"," + wnum(m_rc.top) + L"," +
             wnum(m_rc.right) + L"," + wnum(m_rc.bottom) + L") editExists=" +
             wnum(m_edit ? 1 : 0));
        if (!m_edit) {
            if (!createEdit()) {
                // 父窗口尚未就绪（宿主布局变化时句柄可能暂时失效）。
                // 不返回失败：宿主通常还会调用 SetRect / DoPreview，
                // 那时再试一次；仍不行则由 DoPreview 走顶层窗口兜底。
                logw(L"[SetWindow] createEdit deferred (parent not ready yet)");
            }
        }
        applyRect();
        // 若 DoPreview 先于 SetWindow 到达，这里补一次内容输出
        if (m_inited && !m_rtf.empty()) applyContent();
        return S_OK;
    }
    STDMETHODIMP SetFocus(void) override {
        if (m_edit) { ::SetFocus(m_edit); return S_OK; }
        return S_FALSE;
    }
    STDMETHODIMP QueryFocus(HWND* phwnd) override {
        if (!phwnd) return E_POINTER;
        *phwnd = m_edit;
        return m_edit ? S_OK : E_FAIL;
    }
    STDMETHODIMP TranslateAccelerator(MSG*) override { return S_FALSE; }
    STDMETHODIMP SetRect(const RECT* prc) override {
        if (!prc) return E_INVALIDARG;
        m_rc = *prc;
        logw(std::wstring(L"[SetRect] rect=(") + wnum(m_rc.left) + L"," + wnum(m_rc.top) +
             L"," + wnum(m_rc.right) + L"," + wnum(m_rc.bottom) + L")");
        applyRect();
        return S_OK;
    }
    STDMETHODIMP DoPreview(void) override {
        logw(std::wstring(L"[DoPreview] enter inited=") + wnum(m_inited ? 1 : 0) +
             L" file=" + wstr(m_file.c_str()));
        if (!m_inited) return E_FAIL;
        if (m_md.empty()) m_md = readFileUtf8(m_file.c_str());
        if (m_md.empty()) {
            logw(L"[DoPreview] no content -> return E_FAIL");
            return E_FAIL;
        }
        m_rtf = md2rtf::convert(m_md);
        m_plain = utf8ToWide(m_md);
        logw(std::wstring(L"[DoPreview] rtf chars=") + wnum((long long)m_rtf.size()) +
             L" plain chars=" + wnum((long long)m_plain.size()));
        if (!m_edit) {
            if (!createEdit()) {
                // 父窗口始终无效（典型原因：预览窗格没打开）。
                // 退而求其次建顶层窗口，保证内容至少可见。
                logw(L"[DoPreview] parent still not ready -> top-level fallback");
                if (!createEditTopLevel()) {
                    logw(L"[DoPreview] no window could be created -> E_FAIL");
                    return E_FAIL;
                }
            }
        }
        applyRect();
        applyContent();
        return S_OK;
    }
    STDMETHODIMP Unload(void) override {
        logw(L"[Unload]");
        destroyEdit();
        m_file.clear();
        m_md.clear();
        m_rtf.clear();
        m_plain.clear();
        m_inited = false;
        m_windowed = false;
        return S_OK;
    }

    // IPreviewHandlerVisuals
    STDMETHODIMP SetBackgroundColor(COLORREF color) override {
        m_bg = color;
        if (m_edit) SendMessageW(m_edit, EM_SETBKGNDCOLOR, 0, (LPARAM)color);
        return S_OK;
    }
    STDMETHODIMP SetFont(const LOGFONTW* plf) override {
        // 真实 SDK 签名为 (const LOGFONTW*)；暂不使用
        return S_OK;
    }
    STDMETHODIMP SetTextColor(COLORREF color) override { m_text = color; return S_OK; }

    // IObjectWithSite
    STDMETHODIMP SetSite(IUnknown* pUnkSite) override {
        if (m_site) { m_site->Release(); m_site = nullptr; }
        m_site = pUnkSite;
        if (m_site) m_site->AddRef();
        return S_OK;
    }
    STDMETHODIMP GetSite(REFIID riid, void** ppvSite) override {
        if (!ppvSite) return E_POINTER;
        *ppvSite = nullptr;
        if (!m_site) return E_FAIL;
        return m_site->QueryInterface(riid, ppvSite);
    }

private:
    // 保证创建 RichEdit 的线程已做 OLE 初始化（Rich Edit 4.1/5.0 的硬性要求）
    void ensureOle() {
        if (m_oleInited) return;
        HRESULT hr = OleInitialize(nullptr);
        if (SUCCEEDED(hr)) {
            m_oleInited = true;
            m_oleThread = GetCurrentThreadId();
            logw(std::wstring(L"ensureOle: OleInitialize -> ") + hrStr(hr));
        } else {
            logw(std::wstring(L"ensureOle: OleInitialize failed ") + hrStr(hr) +
                 L" (err=" + wnum((long long)GetLastError()) + L")");
        }
    }

    // 创建预览窗口。
    // 关键认知（2026-10-23 实测）：宿主传进来的父窗口类名是
    //   "Shell Preview Extension Host Previewer"，而且它就创建在 *prevhost 自己进程内*
    //   （GetWindowThreadProcessId(parent) == GetCurrentProcessId()）。
    //   这正是低完整性预览处理器能嵌入窗格的原因：父子窗口同进程同完整性，UIPI 不拦。
    // 因此：父窗口有效就坚决用它（哪怕它就在自己进程里，也绝不要传 NULL）；
    //      无效则返回 false，由调用方延后重试（宿主布局变化时句柄可能暂时失效）。
    bool createEdit() {
        ensureOle();
        LoadLibraryW(L"msftedit.dll"); // 确保 RICHEDIT50W 窗口类已注册
        BOOL pw = IsWindow(m_parent);
        DWORD wpid = 0;
        if (pw) GetWindowThreadProcessId(m_parent, &wpid);
        wchar_t cls[128]; cls[0] = L'\0';
        if (pw) GetClassNameW(m_parent, cls, 128);
        logw(std::wstring(L"createEdit: parent=") + wptr((void*)m_parent) +
             L" IsWindow=" + wnum(pw ? 1 : 0) + L" cls=" + wstr(cls) +
             L" ownerPid=" + wnum((long long)wpid) +
             L" selfPid=" + wnum((long long)GetCurrentProcessId()));
        if (!pw) return false; // 父窗口还没就绪 -> 调用方稍后重试

        int w = m_rc.right - m_rc.left;
        int h = m_rc.bottom - m_rc.top;
        if (w <= 0) w = 400;
        if (h <= 0) h = 300;
        m_edit = CreateWindowExW(0, L"RICHEDIT50W", L"",
            WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
            m_rc.left, m_rc.top, w, h, m_parent, nullptr, g_hInstance, nullptr);
        if (!m_edit) {
            DWORD e1 = GetLastError();
            // 退化路径：Rich Edit 1.0（老但更普及）
            m_edit = CreateWindowExW(0, L"RICHEDIT", L"",
                WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
                m_rc.left, m_rc.top, w, h, m_parent, nullptr, g_hInstance, nullptr);
            if (!m_edit) {
                DWORD e2 = GetLastError();
                // 最终退化：纯文本 EDIT 控件（无法渲染 RTF，但保证有内容可见）
                m_edit = CreateWindowExW(0, L"EDIT", L"",
                    WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
                    m_rc.left, m_rc.top, w, h, m_parent, nullptr, g_hInstance, nullptr);
                if (!m_edit) {
                    SetLastError(e2);
                    logw(std::wstring(L"createEdit: all controls failed (rich50=") + wnum(e1) +
                         L" rich1=" + wnum(e2) + L" edit=" + wnum((long long)GetLastError()) + L")");
                    return false;
                }
                m_plainMode = true;
                logw(std::wstring(L"createEdit: fell back to plain EDIT control (rich50 err=") +
                     wnum(e1) + L" rich1 err=" + wnum(e2) + L")");
            } else {
                m_plainMode = true; // Rich Edit 1.0 不支持 EM_SETTEXTEX/ST_RTF
                logw(std::wstring(L"createEdit: fell back to RICHEDIT 1.0 (err50=") + wnum(e1) + L")");
            }
        } else {
            logw(std::wstring(L"createEdit: RICHEDIT50W ok hwnd=") + wptr((void*)m_edit) +
                 L" parent=" + wptr((void*)m_parent));
        }
        // 关键：彻底断开输入法与本窗口关联，任何激活的 IME 都不会再作用于预览窗格
        ImmAssociateContext(m_edit, nullptr);
        SendMessageW(m_edit, EM_SETBKGNDCOLOR, 0, (LPARAM)m_bg);
        SendMessageW(m_edit, EM_SETMARGINS, (WPARAM)(EC_LEFTMARGIN | EC_RIGHTMARGIN), (LPARAM)MAKELONG(10, 10));
        m_windowed = true;
        return true;
    }

    // 最后兜底：宿主始终没给有效父窗口（例如预览窗格没打开）时，
    // 建一个顶层窗口放在窗格区域，至少保证内容可见（不会嵌入，但比一片空白好）。
    bool createEditTopLevel() {
        ensureOle();
        LoadLibraryW(L"msftedit.dll");
        int w = m_rc.right - m_rc.left;
        int h = m_rc.bottom - m_rc.top;
        if (w <= 0) w = 400;
        if (h <= 0) h = 300;
        HWND top = CreateWindowExW(WS_EX_TOOLWINDOW, L"RICHEDIT50W", L"",
            WS_POPUP | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
            m_rc.left, m_rc.top, w, h, nullptr, nullptr, g_hInstance, nullptr);
        if (!top) {
            logw(std::wstring(L"createEditTopLevel: failed err=") + wnum((long long)GetLastError()));
            return false;
        }
        m_edit = top;
        logw(std::wstring(L"createEditTopLevel: top-level hwnd=") + wptr((void*)top));
        ImmAssociateContext(m_edit, nullptr);
        SendMessageW(m_edit, EM_SETBKGNDCOLOR, 0, (LPARAM)m_bg);
        SendMessageW(m_edit, EM_SETMARGINS, (WPARAM)(EC_LEFTMARGIN | EC_RIGHTMARGIN), (LPARAM)MAKELONG(10, 10));
        m_windowed = true;
        return true;
    }

    void destroyEdit() {
        if (m_edit) {
            DestroyWindow(m_edit);
            m_edit = nullptr;
        }
        m_plainMode = false;
    }

    void applyRect() {
        if (!m_edit) return;
        int w = m_rc.right - m_rc.left;
        int h = m_rc.bottom - m_rc.top;
        if (w <= 0) w = 400;
        if (h <= 0) h = 300;
        MoveWindow(m_edit, m_rc.left, m_rc.top, w, h, TRUE);
    }

    // 输出内容：优先 RTF（富文本），若宿主上的 RichEdit 不接受 RTF 则退化为纯文本
    void applyContent() {
        if (!m_edit) return;
        if (m_plainMode || m_rtf.empty()) {
            SendMessageW(m_edit, WM_SETTEXT, 0, (LPARAM)m_plain.c_str());
            logw(std::wstring(L"applyContent: plain text mode, len=") +
                 wnum((long long)m_plain.size()));
            return;
        }
        // EM_SETTEXTEX + ST_RTF 要求传入 ANSI 字符串（RTF 控制流是 ASCII，
        // 非 ASCII 字符一律由 \uN 转义携带），因此这里做宽->窄转换。
        // 注意：不能带 BOM，否则 RichEdit 解析直接失败（ret=0）。
        std::string rtfAnsi = wideToAnsi(m_rtf);
        if (!rtfAnsi.empty() && (unsigned char)rtfAnsi[0] == 0xEF) {
            // 理论上不会发生（BOM 是 U+FEFF，转窄后可能变成 0x? ）——这里做防御性剥离
            size_t b = 0;
            if (rtfAnsi.size() >= 3 && (unsigned char)rtfAnsi[0] == 0xEF &&
                (unsigned char)rtfAnsi[1] == 0xBB && (unsigned char)rtfAnsi[2] == 0xBF) b = 3;
            if (b) rtfAnsi = rtfAnsi.substr(b);
        }
        SETTEXTEX st; st.flags = ST_RTF; st.codepage = CP_ACP;
        LRESULT r = SendMessageW(m_edit, EM_SETTEXTEX, (WPARAM)&st, (LPARAM)rtfAnsi.c_str());
        int len = (int)GetWindowTextLengthW(m_edit);
        logw(std::wstring(L"applyContent: EM_SETTEXTEX ret=") + wnum((long long)r) +
             L", textLength=" + wnum(len) + L", rtfAnsiBytes=" + wnum((long long)rtfAnsi.size()));
        if (len <= 0) {
            // RTF 未被接受（部分宿主上的 RichEdit 行为不同）→ 退化纯文本，保证可见
            SendMessageW(m_edit, WM_SETTEXT, 0, (LPARAM)m_plain.c_str());
            int len2 = (int)GetWindowTextLengthW(m_edit);
            logw(std::wstring(L"applyContent: RTF produced empty -> plain fallback len=") +
                 wnum(len2));
        }
    }

    LONG      m_ref;
    std::wstring m_file;
    std::string  m_md;
    std::wstring m_rtf;
    std::wstring m_plain;
    HWND      m_parent;
    HWND      m_edit;
    RECT      m_rc;
    COLORREF  m_bg;
    COLORREF  m_text;
    IUnknown* m_site;
    bool      m_inited;
    bool      m_windowed;
    bool      m_oleInited;
    DWORD     m_oleThread;
    bool      m_plainMode;
};

// ---- 类厂 ----
class ClassFactory : public IClassFactory {
public:
    STDMETHODIMP_(ULONG) AddRef() override { return 2; }
    STDMETHODIMP_(ULONG) Release() override { return 1; }
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
            *ppv = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    STDMETHODIMP CreateInstance(IUnknown* pUnkOuter, REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        if (pUnkOuter) return CLASS_E_NOAGGREGATION;
        PreviewHandler* p = new (std::nothrow) PreviewHandler();
        if (!p) return E_OUTOFMEMORY;
        HRESULT hr = p->QueryInterface(riid, ppv);
        p->Release(); // 抵消构造时的引用；QI 已 addref
        return hr;
    }
    STDMETHODIMP LockServer(BOOL fLock) override {
        InterlockedExchangeAdd(&g_lockCount, fLock ? 1 : -1);
        return S_OK;
    }
};

// ---- 注册表辅助 ----
static HRESULT SetRegString(HKEY hkParent, const wchar_t* subkey, const wchar_t* valueName, const wchar_t* value) {
    HKEY hk;
    DWORD disp;
    LONG r = RegCreateKeyExW(hkParent, subkey, 0, nullptr, REG_OPTION_NON_VOLATILE,
                             KEY_WRITE, nullptr, &hk, &disp);
    if (r != ERROR_SUCCESS) return HRESULT_FROM_WIN32(r);
    r = RegSetValueExW(hk, valueName, 0, REG_SZ, (const BYTE*)value,
                       (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(hk);
    return (r == ERROR_SUCCESS) ? S_OK : HRESULT_FROM_WIN32(r);
}

// ---- DllMain ----
// 当前进程的完整性级别。prevhost.exe 按设计以 Low 完整性运行（防止恶意预览文件
// 提权），这直接决定了它能写哪些位置；日志里带上它，一眼就能判断「日志去哪了」。
static std::wstring integrityLevel() {
    HANDLE tok = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) return L"?(no token)";
    DWORD len = 0;
    GetTokenInformation(tok, TokenIntegrityLevel, nullptr, 0, &len);
    std::vector<BYTE> buf(len ? len : 128);
    std::wstring result = L"?";
    if (GetTokenInformation(tok, TokenIntegrityLevel, buf.data(), (DWORD)buf.size(), &len)) {
        TOKEN_MANDATORY_LABEL* tml = (TOKEN_MANDATORY_LABEL*)buf.data();
        if (tml && tml->Label.Sid && IsValidSid(tml->Label.Sid)) {
            UCHAR cnt = *GetSidSubAuthorityCount(tml->Label.Sid);
            DWORD rid = cnt > 0 ? *GetSidSubAuthority(tml->Label.Sid, 0) : 0;
            const wchar_t* name = L"Unknown";
            switch (rid) {
                case SECURITY_MANDATORY_UNTRUSTED_RID:       name = L"Untrusted"; break;
                case SECURITY_MANDATORY_LOW_RID:             name = L"Low"; break;
                case SECURITY_MANDATORY_MEDIUM_RID:          name = L"Medium"; break;
                case SECURITY_MANDATORY_MEDIUM_PLUS_RID:     name = L"MediumPlus"; break;
                case SECURITY_MANDATORY_HIGH_RID:            name = L"High"; break;
                case SECURITY_MANDATORY_SYSTEM_RID:          name = L"System"; break;
                case SECURITY_MANDATORY_PROTECTED_PROCESS_RID: name = L"ProtectedProcess"; break;
            }
            wchar_t b[80];
            swprintf(b, 80, L"%s(0x%04X)", name, rid);
            result = b;
        }
    }
    CloseHandle(tok);
    return result;
}

extern "C" BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_hInstance = hinst;
        DisableThreadLibraryCalls(hinst);
        // 记录被加载的 DLL 绝对路径 + 宿主进程路径 + 完整性级别，
        // 用于确认宿主加载的是不是最新构建、宿主是谁、能不能写日志。
        wchar_t p[MAX_PATH];
        if (GetModuleFileNameW(hinst, p, MAX_PATH)) {
            wchar_t host[MAX_PATH];
            std::wstring hostName = L"?";
            if (GetModuleFileNameW(nullptr, host, MAX_PATH)) hostName = host;
            logw(std::wstring(L"[DllMain] loaded: ") + wstr(p) +
                 L" | host=" + hostName + L" | il=" + integrityLevel());
        }
    }
    return TRUE;
}

// ---- Dll 导出 ----
extern "C" STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
    logw(std::wstring(L"[DllGetClassObject] clsid=") + GuidToWString(rclsid));
    if (rclsid != CLSID_MarkFlowPreviewHandler) return CLASS_E_CLASSNOTAVAILABLE;
    static ClassFactory s_cf;
    return s_cf.QueryInterface(riid, ppv);
}

extern "C" STDAPI DllCanUnloadNow(void) {
    return (g_objCount == 0 && g_lockCount == 0) ? S_OK : S_FALSE;
}

extern "C" STDAPI DllRegisterServer(void) {
    std::wstring clsid = GuidToWString(CLSID_MarkFlowPreviewHandler);
    wchar_t dllPath[MAX_PATH];
    if (!GetModuleFileNameW(g_hInstance, dllPath, MAX_PATH)) return E_FAIL;

    std::wstring clsidKey = L"Software\\Classes\\CLSID\\" + clsid;
    SetRegString(HKEY_CURRENT_USER, clsidKey.c_str(), nullptr, L"MarkFlow.MarkdownPreviewHandler");

    // 关键（2026-10-23 定位）：预览处理器必须挂到 Windows 的
    // "Preview Handler Surrogate Host" AppID {6D2B5079-2F0B-48DD-AB7F-97CEC514D30B}
    // （其 DllSurrogate=C:\Windows\system32\prevhost.exe），COM 才会把处理器
    // 激活到独立的预览宿主进程，而不是在 Explorer 进程内加载。
    // 所有系统内置预览器（TXT/RTF/…）与 PowerToys 的处理器都带这个 AppID；
    // 缺了它，Explorer 预览窗格根本不会实例化我们的处理器（表现为"无法预览此文件"）。
    const wchar_t* APPID_SURROGATE = L"{6D2B5079-2F0B-48DD-AB7F-97CEC514D30B}";
    SetRegString(HKEY_CURRENT_USER, clsidKey.c_str(), L"AppID", APPID_SURROGATE);
    SetRegString(HKEY_CURRENT_USER, clsidKey.c_str(), L"DisplayName",
                 L"MarkFlow Markdown Preview Handler");

    // 兜底：确保代理宿主 AppID 键存在（正常情况下系统已有；没有则补写）
    {
        std::wstring appidKey = std::wstring(L"Software\\Classes\\AppID\\") + APPID_SURROGATE;
        HKEY hkTest = nullptr;
        bool exists = (RegOpenKeyExW(HKEY_LOCAL_MACHINE,
            (L"Software\\Classes\\AppID\\" + std::wstring(APPID_SURROGATE)).c_str(),
            0, KEY_READ, &hkTest) == ERROR_SUCCESS);
        if (hkTest) RegCloseKey(hkTest);
        if (!exists) {
            SetRegString(HKEY_LOCAL_MACHINE, appidKey.c_str(), nullptr,
                         L"Preview Handler Surrogate Host");
            SetRegString(HKEY_LOCAL_MACHINE, appidKey.c_str(), L"DllSurrogate",
                         L"C:\\Windows\\system32\\prevhost.exe");
        }
    }

    std::wstring inproc = clsidKey + L"\\InprocServer32";
    SetRegString(HKEY_CURRENT_USER, inproc.c_str(), nullptr, dllPath);
    SetRegString(HKEY_CURRENT_USER, inproc.c_str(), L"ThreadingModel", L"Apartment");
    SetRegString(HKEY_CURRENT_USER, (clsidKey + L"\\ProgID").c_str(), nullptr,
                 L"MarkFlow.MarkdownPreviewHandler.1");

    // 挂载点 1：扩展名级（Shell 的标准位置）
    const wchar_t* exts[] = { L".md", L".markdown", L".mdown", L".mkd" };
    for (const wchar_t* ext : exts) {
        std::wstring shellex = std::wstring(L"Software\\Classes\\") + ext +
                               L"\\shellex\\" + PREVIEW_SLOT;
        SetRegString(HKEY_CURRENT_USER, shellex.c_str(), nullptr, clsid.c_str());
    }

    // 挂载点 2：ProgID 级（MarkFlow.mdfile）——部分宿主按 ProgID 解析，双保险
    const wchar_t* progids[] = { L"MarkFlow.mdfile", L"MarkFlow.markdownfile" };
    for (const wchar_t* pid : progids) {
        std::wstring shellex = std::wstring(L"Software\\Classes\\") + pid +
                               L"\\shellex\\" + PREVIEW_SLOT;
        SetRegString(HKEY_CURRENT_USER, shellex.c_str(), nullptr, clsid.c_str());
    }

    SetRegString(HKEY_CURRENT_USER,
                 L"Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
                 clsid.c_str(), L"MarkFlow Markdown Preview Handler");
    logw(std::wstring(L"[DllRegisterServer] done dll=") + wstr(dllPath));
    return S_OK;
}

extern "C" STDAPI DllUnregisterServer(void) {
    std::wstring clsid = GuidToWString(CLSID_MarkFlowPreviewHandler);
    RegDeleteTreeW(HKEY_CURRENT_USER, (L"Software\\Classes\\CLSID\\" + clsid).c_str());
    const wchar_t* exts[] = { L".md", L".markdown", L".mdown", L".mkd" };
    for (const wchar_t* ext : exts) {
        std::wstring shellex = std::wstring(L"Software\\Classes\\") + ext +
                               L"\\shellex\\" + PREVIEW_SLOT;
        RegDeleteTreeW(HKEY_CURRENT_USER, shellex.c_str());
    }
    const wchar_t* progids[] = { L"MarkFlow.mdfile", L"MarkFlow.markdownfile" };
    for (const wchar_t* pid : progids) {
        std::wstring shellex = std::wstring(L"Software\\Classes\\") + pid +
                               L"\\shellex\\" + PREVIEW_SLOT;
        RegDeleteTreeW(HKEY_CURRENT_USER, shellex.c_str());
    }
    HKEY hk;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
                      L"Software\\Microsoft\\Windows\\CurrentVersion\\PreviewHandlers",
                      0, KEY_WRITE, &hk) == ERROR_SUCCESS) {
        RegDeleteValueW(hk, clsid.c_str());
        RegCloseKey(hk);
    }
    logw(L"[DllUnregisterServer] done");
    return S_OK;
}
