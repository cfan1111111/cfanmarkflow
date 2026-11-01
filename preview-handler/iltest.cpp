// iltest.cpp - run this exe BOTH as-is (medium integrity) and with a Low
// mandatory label (icacls iltest.exe /setintegritylevel Low) to find out
// whether a low-integrity process can validate and create child windows of a
// medium-integrity parent (Explorer preview pane).
//
// usage: iltest.exe <hwnd-hex>
#include <windows.h>
#include <stdio.h>

static const char* ilName(DWORD rid) {
    switch (rid) {
        case 0x0000: return "Untrusted";
        case 0x1000: return "Low";
        case 0x2000: return "Medium";
        case 0x2100: return "MediumPlus";
        case 0x3000: return "High";
        case 0x4000: return "System";
        default: return "?";
    }
}

int main(int argc, char** argv) {
    if (argc < 2) { printf("usage: iltest <hwnd-hex>\n"); return 1; }
    HWND target = (HWND)(ULONG_PTR)strtoull(argv[1], NULL, 16);

    // self integrity level
    HANDLE tok = NULL;
    DWORD rid = 0xFFFF;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) {
        DWORD len = 0;
        GetTokenInformation(tok, TokenIntegrityLevel, NULL, 0, &len);
        BYTE* buf = (BYTE*)malloc(len ? len : 64);
        if (GetTokenInformation(tok, TokenIntegrityLevel, buf, len, &len)) {
            TOKEN_MANDATORY_LABEL* tml = (TOKEN_MANDATORY_LABEL*)buf;
            PUCHAR cnt = GetSidSubAuthorityCount(tml->Label.Sid);
            if (cnt && *cnt > 0) rid = *GetSidSubAuthority(tml->Label.Sid, 0);
        }
        free(buf);
        CloseHandle(tok);
    }
    printf("self integrity      : %s (0x%04X) pid=%lu\n", ilName(rid), (unsigned int)rid, GetCurrentProcessId());

    printf("target hwnd         : 0x%p\n", (void*)target);
    printf("IsWindow            : %d\n", IsWindow(target) ? 1 : 0);
    DWORD pid = 0;
    DWORD tid = GetWindowThreadProcessId(target, &pid);
    printf("GetWindowThreadProc : tid=%lu pid=%lu\n", tid, pid);
    char cls[256] = "";
    GetClassNameA(target, cls, 256);
    printf("GetClassName        : '%s'\n", cls);

    // 1) try to create a child EDIT of the target window
    HWND c1 = CreateWindowExA(0, "EDIT", "child-of-target",
        WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_READONLY,
        0, 0, 200, 100, target, NULL, GetModuleHandleA(NULL), NULL);
    printf("CreateWindowEx child(of target): hwnd=0x%p err=%lu\n", (void*)c1, GetLastError());

    // 2) try to create a top-level window and SetParent it onto the target
    HWND top = CreateWindowExA(WS_EX_TOOLWINDOW, "EDIT", "toplevel",
        WS_POPUP, 0, 0, 200, 100, NULL, NULL, GetModuleHandleA(NULL), NULL);
    printf("CreateWindowEx toplevel        : hwnd=0x%p err=%lu\n", (void*)top, GetLastError());
    if (top) {
        HWND r = SetParent(top, target);
        printf("SetParent(top -> target)      : 0x%p err=%lu\n", (void*)r, GetLastError());
        if (!r) DestroyWindow(top);
    }
    if (c1) DestroyWindow(c1);
    return 0;
}
