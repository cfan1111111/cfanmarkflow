// imeprobe.cpp — IME 压力测试：把焦点和按键送进预览窗格，
// 强制 TSF 把万能五笔(wnTSF.ime)加载进 prevhost，验证宿主不崩。
//
// 背景：原先 PowerToys 的 WebView2 预览器被 wnTSF.ime 搞崩；
// 本处理器用原生 RichEdit，理论上不受影响，此工具用于实测。
//
// 用法：imeprobe.exe [pid]
//   不传 pid 时自动寻找"托管 RICHEDIT50W 的 prevhost"。
#include <windows.h>
#include <imm.h>
#include <stdio.h>
#include <tlhelp32.h>
#include <initializer_list>

static DWORD g_targetPid = 0;      // prevhost 的 PID（0 = 自动找）
static HWND  g_rich = NULL;        // 我们的 RICHEDIT50W 窗口
static RECT  g_richRect = {0};
static wchar_t g_richCls[128] = L"";
static DWORD g_richPid = 0;

static HWND  g_previewer = NULL;   // Shell Preview Extension Host Previewer 窗口

// 递归找 RichEdit：预览器窗口已被重父化进 Explorer 的预览窗格，
// 不再是顶层窗口，EnumWindows 看不到，必须递归子窗口。
// 实测窗口链有 8 层（曾把深度限死为 6，导致永远找不到 RichEdit）：
//   CabinetWClass > ShellTabWindowClass > DUIViewWndClassName > DirectUIHWND
//     > CtrlNotifySink > Shell Preview Extension Host
//     > Shell Preview Extension Host Previewer > RICHEDIT50W
// 注意：必须用真正的回调函数（曾用捕获式 lambda 转 WNDENUMPROC，静默失效）
static int g_ed = 0;   // 递归深度

static BOOL CALLBACK enumDeepCb(HWND h, LPARAM lp) {
    if (g_ed > 12) return TRUE;
    wchar_t cls[128] = {0};
    GetClassNameW(h, cls, 128);
    if (wcsstr(cls, L"RICHEDIT")) {
        g_rich = h;
        GetWindowRect(h, &g_richRect);
        wcsncpy(g_richCls, cls, 127);
        return FALSE;   // 找到，停止
    }
    if (wcsstr(cls, L"Preview Extension Host Previewer")) g_previewer = h;
    g_ed++;
    EnumChildWindows(h, enumDeepCb, 0);
    g_ed--;
    return TRUE;
}

static BOOL CALLBACK enumProc(HWND h, LPARAM lp) {
    wchar_t cls[128] = {0};
    GetClassNameW(h, cls, 128);
    if (GetEnvironmentVariableW(L"IMEPROBE_DEBUG", NULL, 0))
        wprintf(L"[enumProc] hwnd=%p cls=%ls\n", (void*)h, cls);
    // 顶层 Explorer 窗口（文件夹窗口 / CabinetWClass）
    if (wcsstr(cls, L"CabinetWClass") || wcsstr(cls, L"ExploreWClass")) {
        g_ed = 1;
        EnumChildWindows(h, enumDeepCb, 0);
        if (g_rich) { GetWindowThreadProcessId(g_rich, &g_richPid); return FALSE; }
    }
    return TRUE;
}

static DWORD findPrevhostPid(void) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W pe = { sizeof(pe) };
    DWORD pid = 0;
    if (Process32FirstW(snap, &pe)) {
        do {
            if (_wcsicmp(pe.szExeFile, L"prevhost.exe") == 0) { pid = pe.th32ProcessID; break; }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return pid;
}

static bool pidAlive(DWORD pid) {
    HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!h) return false;
    DWORD r = WaitForSingleObject(h, 0);
    CloseHandle(h);
    return r == WAIT_TIMEOUT;
}

// 检查目标线程中真正持有焦点的窗口（验证输入是否真的落到 RichEdit 上）
static void reportFocus(HWND target) {
    DWORD tid = GetWindowThreadProcessId(target, NULL);
    GUITHREADINFO gti = { sizeof(GUITHREADINFO) };
    if (!GetGUIThreadInfo(tid, &gti)) {
        wprintf(L"GetGUIThreadInfo failed: %lu\n", GetLastError());
        return;
    }
    wprintf(L"thread focus: hwndFocus=%p hwndActive=%p (our rich=%p) -> %ls\n",
            (void*)gti.hwndFocus, (void*)gti.hwndActive, (void*)target,
            gti.hwndFocus == target ? L"INPUT LANDS ON RICHEDIT" : L"focus elsewhere");
}

// 枚举目标进程的模块，报告 IME DLL 是否加载（万能五笔 = wnTSF.ime）
static void reportImeModules(DWORD pid) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (snap == INVALID_HANDLE_VALUE) { wprintf(L"module snapshot failed: %lu\n", GetLastError()); return; }
    MODULEENTRY32W me = { sizeof(me) };
    bool wntsf = false, msctf = false, imm32 = false;
    if (Module32FirstW(snap, &me)) {
        do {
            if (_wcsicmp(me.szModule, L"wnTSF.ime") == 0) wntsf = true;
            if (_wcsicmp(me.szModule, L"MSCTF.dll") == 0) msctf = true;
            if (_wcsicmp(me.szModule, L"IMM32.dll") == 0) imm32 = true;
        } while (Module32NextW(snap, &me));
    }
    CloseHandle(snap);
    wprintf(L"modules in prevhost: wnTSF.ime=%d MSCTF=%d IMM32=%d\n", wntsf ? 1 : 0, msctf ? 1 : 0, imm32 ? 1 : 0);
    if (wntsf) wprintf(L"*** Universal Wubi (wnTSF.ime) IS loaded in prevhost -> IME truly exercised ***\n");
}

static DWORD g_listPid = 0;   // list 模式用
static int   g_deepDepth = 0; // deep 模式递归深度
static HWND  g_chain[16];     // deep 模式祖先链

static void printChain(HWND leaf) {
    wprintf(L"  RICHEDIT FOUND hwnd=%p\n", (void*)leaf);
    for (int i = 0; i < g_deepDepth && i < 16; i++) {
        wchar_t cls[128] = {0}, title[128] = {0};
        GetClassNameW(g_chain[i], cls, 128); GetWindowTextW(g_chain[i], title, 128);
        DWORD pid = 0; GetWindowThreadProcessId(g_chain[i], &pid);
        wprintf(L"    [%d] hwnd=%8p pid=%6lu cls=%-45ls title=%ls\n",
                i, (void*)g_chain[i], pid, cls, title);
    }
}

static BOOL CALLBACK deepCb(HWND h, LPARAM lp) {
    wchar_t cls[128] = {0};
    GetClassNameW(h, cls, 128);
    bool isTarget = wcsstr(cls, L"RICHEDIT") || wcsstr(cls, L"Preview Extension Host Previewer");
    if (isTarget) {
        if (g_deepDepth < 16) g_chain[g_deepDepth] = h;
        printChain(h);
        // Previewer 匹配后继续往下递归（RichEdit 是它的子窗口）
        if (wcsstr(cls, L"RICHEDIT")) return TRUE;
    }
    if (g_deepDepth < 16) g_chain[g_deepDepth] = h;
    g_deepDepth++;
    EnumChildWindows(h, deepCb, 0);
    g_deepDepth--;
    return TRUE;
}

static BOOL CALLBACK listCb(HWND h, LPARAM) {
    wchar_t cls[128] = {0}, title[256] = {0};
    GetClassNameW(h, cls, 128); GetWindowTextW(h, title, 256);
    DWORD pid = 0; GetWindowThreadProcessId(h, &pid);
    bool mine = (g_listPid && pid == g_listPid);
    bool interesting = wcsstr(cls, L"Preview") || wcsstr(cls, L"RichEdit") ||
                       wcsstr(cls, L"RICHEDIT") || wcsstr(cls, L"prevhost");
    if (mine || interesting)
        wprintf(L"hwnd=%8p pid=%6lu vis=%d cls=%-45ls title=%ls\n",
                (void*)h, pid, IsWindowVisible(h) ? 1 : 0, cls, title);
    return TRUE;
}

int wmain(int argc, wchar_t** argv) {
    setvbuf(stdout, nullptr, _IONBF, 0);   // 关缓冲，确保输出不丢
    if (argc > 1 && wcscmp(argv[1], L"list") == 0) {
        // 诊断模式：列出 prevhost 拥有的窗口 + 含 Preview/RichEdit 的窗口
        g_listPid = findPrevhostPid();
        wprintf(L"prevhost pid = %lu\n", g_listPid);
        EnumWindows(listCb, 0);
        return 0;
    }
    if (argc > 1 && wcscmp(argv[1], L"deep") == 0) {
        // 诊断模式：从每个顶层窗口递归向下，打印 RICHEDIT / Previewer 的祖先链
        struct D { static BOOL CALLBACK cb(HWND h, LPARAM) {
            g_deepDepth = 0;
            if (g_deepDepth < 16) g_chain[0] = h;
            g_deepDepth = 1;
            EnumChildWindows(h, deepCb, 0);
            return TRUE;
        }};
        EnumWindows(D::cb, 0);
        wprintf(L"deep scan done\n");
        return 0;
    }
    if (argc > 1 && wcscmp(argv[1], L"wubi") == 0) {
        // 五笔专项：置前景 → 点窗格 → Win+Space 切换输入法 → 打字 → 检测 wnTSF.ime
        g_rich = NULL;
        for (int tries = 0; tries < 30 && !g_rich; tries++) {
            EnumWindows(enumProc, 0);
            if (!g_rich) Sleep(500);
        }
        if (!g_rich) { wprintf(L"NO RichEdit window found\n"); return 2; }
        DWORD pid = g_richPid;
        wprintf(L"RichEdit=%p prevhost pid=%lu\n", (void*)g_rich, pid);

        HWND root = GetAncestor(g_rich, GA_ROOT);
        ShowWindow(root, SW_RESTORE);
        DWORD rootTid = GetWindowThreadProcessId(root, NULL);
        DWORD myTid = GetCurrentThreadId();
        if (rootTid && rootTid != myTid) AttachThreadInput(myTid, rootTid, TRUE);
        SetForegroundWindow(root); BringWindowToTop(root);
        if (rootTid && rootTid != myTid) AttachThreadInput(myTid, rootTid, FALSE);
        Sleep(400);

        RECT rc; GetWindowRect(g_rich, &rc);
        int nx = (int)((((rc.left + rc.right) / 2) * 65535LL) / GetSystemMetrics(SM_CXSCREEN));
        int ny = (int)((((rc.top + rc.bottom) / 2) * 65535LL) / GetSystemMetrics(SM_CYSCREEN));
        INPUT in[32]; ZeroMemory(in, sizeof(in));
        int n = 0;
        auto addKey = [&](WORD vk, bool up) {
            in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = vk;
            in[n].ki.dwFlags = up ? KEYEVENTF_KEYUP : 0; n++;
        };
        auto addClick = [&]() {
            in[n].type = INPUT_MOUSE; in[n].mi.dx = nx; in[n].mi.dy = ny;
            in[n].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE; n++;
            in[n].type = INPUT_MOUSE; in[n].mi.dx = nx; in[n].mi.dy = ny;
            in[n].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN; n++;
            in[n].type = INPUT_MOUSE; in[n].mi.dx = nx; in[n].mi.dy = ny;
            in[n].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP; n++;
        };
        addClick();
        SendInput(n, in, sizeof(INPUT)); n = 0;
        Sleep(600);
        reportFocus(g_rich);

        // 切换输入法：Win+Space + Enter（Win11 切换器飞出后需回车提交）
        addKey(VK_LWIN, false); addKey(VK_SPACE, false);
        addKey(VK_SPACE, true);  addKey(VK_LWIN, true);
        SendInput(n, in, sizeof(INPUT)); n = 0;
        Sleep(600);
        addKey(VK_RETURN, false); addKey(VK_RETURN, true);
        SendInput(n, in, sizeof(INPUT)); n = 0;
        wprintf(L"sent Win+Space + Enter\n");
        Sleep(1200);

        // 打字母（五笔码位 a b c d k l m w），空格上屏、ESC 取消
        for (int round = 1; round <= 3 && pidAlive(pid); round++) {
            for (WORD k : { (WORD)'A', (WORD)'B', (WORD)'C', (WORD)'D', (WORD)'K', (WORD)'L' })
                { addKey(k, false); addKey(k, true); }
            addKey(VK_SPACE, false); addKey(VK_SPACE, true);
            addKey(VK_ESCAPE, false); addKey(VK_ESCAPE, true);
            SendInput(n, in, sizeof(INPUT)); n = 0;
            wprintf(L"round %d: typed 6 letters + space + esc; prevhost alive=%d\n", round, pidAlive(pid) ? 1 : 0);
            reportImeModules(pid);
            Sleep(800);
        }
        if (!pidAlive(pid)) { wprintf(L"*** prevhost CRASHED during Wubi test ***\n"); return 3; }
        wprintf(L"prevhost survived all rounds -> STABLE\n");
        return 0;
    }
    if (argc > 1 && wcscmp(argv[1], L"selfro") == 0) {
        // 自测：在自己进程里建一个【只读】RichEdit，聚焦打字，
        // 看 IME DLL 是否会加载进本进程——分辨"只读是否阻断组字"。
        WNDCLASSW wc = {0};
        wc.lpfnWndProc = DefWindowProcW; wc.hInstance = GetModuleHandleW(NULL);
        wc.lpszClassName = L"MfSelfRoTest";
        RegisterClassW(&wc);
        LoadLibraryW(L"msftedit.dll");   // 注册 RICHEDIT50W 类
        HWND w = CreateWindowW(L"MfSelfRoTest", L"self read-only test",
                               WS_OVERLAPPEDWINDOW, 100, 100, 500, 400,
                               NULL, NULL, GetModuleHandleW(NULL), NULL);
        HWND e = CreateWindowExW(0, L"RICHEDIT50W", L"read-only content",
                                 WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY,
                                 0, 0, 480, 360, w, NULL, GetModuleHandleW(NULL), NULL);
        if (!e) wprintf(L"read-only RICHEDIT50W create FAILED err=%lu\n", GetLastError());
        ShowWindow(w, SW_SHOW);
        SetForegroundWindow(w);
        SetFocus(e);
        Sleep(500);
        reportFocus(e);

        INPUT in[16]; ZeroMemory(in, sizeof(in));
        int n = 0;
        for (WORD k : { (WORD)'A', (WORD)'B', (WORD)'C', (WORD)'D' }) {
            in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = k; n++;
            in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = k; in[n].ki.dwFlags = KEYEVENTF_KEYUP; n++;
        }
        SendInput(n, in, sizeof(INPUT));
        Sleep(800);
        wprintf(L"own process modules after typing into READ-ONLY richedit:\n");
        reportImeModules(GetCurrentProcessId());

        // 对照组：再建一个【可写】EDIT，切换输入法后同样打字
        HWND e2 = CreateWindowExW(0, L"EDIT", L"",
                                  WS_CHILD | WS_VISIBLE | ES_MULTILINE,
                                  0, 0, 480, 360, w, NULL, GetModuleHandleW(NULL), NULL);
        SetFocus(e2);
        Sleep(400);
        reportFocus(e2);
        // 尝试切到中文输入模式：Ctrl+Space（经典 IMM32 IME 切换键）
        {
            INPUT t[4]; ZeroMemory(t, sizeof(t));
            t[0].type = INPUT_KEYBOARD; t[0].ki.wVk = VK_CONTROL;
            t[1].type = INPUT_KEYBOARD; t[1].ki.wVk = VK_SPACE;
            t[2].type = INPUT_KEYBOARD; t[2].ki.wVk = VK_SPACE; t[2].ki.dwFlags = KEYEVENTF_KEYUP;
            t[3].type = INPUT_KEYBOARD; t[3].ki.wVk = VK_CONTROL; t[3].ki.dwFlags = KEYEVENTF_KEYUP;
            SendInput(4, t, sizeof(INPUT));
        }
        Sleep(400);
        n = 0; ZeroMemory(in, sizeof(in));
        for (WORD k : { (WORD)'A', (WORD)'B', (WORD)'C', (WORD)'D' }) {
            in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = k; n++;
            in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = k; in[n].ki.dwFlags = KEYEVENTF_KEYUP; n++;
        }
        SendInput(n, in, sizeof(INPUT));
        Sleep(800);
        wprintf(L"own process modules after typing into WRITABLE edit (Ctrl+Space first):\n");
        reportImeModules(GetCurrentProcessId());
        DestroyWindow(w);
        return 0;
    }
    if (argc > 1) g_targetPid = _wtoi(argv[1]);

    // 1) 枚举所有窗口找 RichEdit（可见的、属于 prevhost 的）
    //    预览可能需要几秒才挂载，轮询等待
    g_rich = NULL;
    for (int tries = 0; tries < 30 && !g_rich; tries++) {
        EnumWindows(enumProc, 0);
        if (!g_rich) Sleep(500);
    }
    if (!g_rich) { wprintf(L"NO RichEdit window found after 15 s (is the preview pane showing our content?)\n"); return 2; }
    wprintf(L"RichEdit : hwnd=%p class=%ls pid=%lu rect=(%ld,%ld)-(%ld,%ld)\n",
            (void*)g_rich, g_richCls, g_richPid,
            g_richRect.left, g_richRect.top, g_richRect.right, g_richRect.bottom);

    // 2) 确认它挂在 prevhost 上
    DWORD pid = g_targetPid ? g_targetPid : g_richPid;
    if (!pidAlive(pid)) { wprintf(L"target pid %lu not alive\n", pid); return 2; }
    wprintf(L"prevhost : pid=%lu alive=1\n", pid);

    // 3) IME 挂载检查（RichEdit 自身的默认 IME 窗口）
    HKL hkl = GetKeyboardLayout(GetWindowThreadProcessId(g_rich, NULL));
    wprintf(L"keyboard layout: %p\n", (void*)hkl);
    HWND imeWnd = ImmGetDefaultIMEWnd(g_rich);
    wprintf(L"ImmGetDefaultIMEWnd(rich)=%p  (0 表示当前未挂 IME 窗口)\n", (void*)imeWnd);

    // 4) 把焦点和按键送进去
    HWND root = GetAncestor(g_rich, GA_ROOT);
    wprintf(L"root owner: hwnd=%p\n", (void*)root);
    ShowWindow(root, SW_RESTORE);
    // 后台进程直接 SetForegroundWindow 会被系统拒绝；
    // 经典解法：AttachThreadInput 把自己的线程挂到目标窗口线程上再置前台。
    DWORD rootTid = GetWindowThreadProcessId(root, NULL);
    DWORD myTid = GetCurrentThreadId();
    if (rootTid && rootTid != myTid) AttachThreadInput(myTid, rootTid, TRUE);
    SetForegroundWindow(root);
    BringWindowToTop(root);
    if (rootTid && rootTid != myTid) AttachThreadInput(myTid, rootTid, FALSE);
    Sleep(500);
    HWND fg = GetForegroundWindow();
    wprintf(L"foreground now: hwnd=%p (want %p) %ls\n", (void*)fg, (void*)root,
            fg == root ? L"OK" : L"MISMATCH");

    int cx = (g_richRect.left + g_richRect.right) / 2;
    int cy = (g_richRect.top + g_richRect.bottom) / 2;
    // 归一化成绝对坐标（0..65535）
    int nx = (int)((cx * 65535LL) / GetSystemMetrics(SM_CXSCREEN));
    int ny = (int)((cy * 65535LL) / GetSystemMetrics(SM_CYSCREEN));

    INPUT in[64]; ZeroMemory(in, sizeof(in));
    // 点击 RichEdit 中心
    in[0].type = INPUT_MOUSE; in[0].mi.dx = nx; in[0].mi.dy = ny;
    in[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    in[1] = in[0]; in[1].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN;
    in[2] = in[0]; in[2].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP;
    // 按键：中文 IME 激活状态下打字母会进入组字，万能五笔会被 TSF 拉起来
    // a, b, c, d（五笔码位），空格上屏，ESC 取消
    WORD keys[] = { 'A', 'B', 'C', 'D', VK_SPACE, VK_ESCAPE, 'K', 'C', VK_SPACE, VK_ESCAPE };
    int n = 3;
    for (WORD k : keys) {
        in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = k; n++;
        in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = k; in[n].ki.dwFlags = KEYEVENTF_KEYUP; n++;
    }
    SendInput(n, in, sizeof(INPUT));
    wprintf(L"sent: 1 click + %d keystrokes into the preview pane\n", (int)(sizeof(keys)/sizeof(keys[0])));

    // 5) 观察 prevhost 是否存活（IME 崩溃会在几百毫秒内发生）
    for (int i = 1; i <= 12; i++) {
        Sleep(500);
        bool alive = pidAlive(pid);
        if (!alive) {
            wprintf(L"*** prevhost CRASHED after %.1f s ***\n", i * 0.5);
            return 3;
        }
    }
    wprintf(L"prevhost still alive after 6 s of IME input -> STABLE\n");
    reportImeModules(pid);

    // 6) 复查 IME 窗口
    imeWnd = ImmGetDefaultIMEWnd(g_rich);
    wprintf(L"ImmGetDefaultIMEWnd(rich) after typing=%p\n", (void*)imeWnd);
    return 0;
}
