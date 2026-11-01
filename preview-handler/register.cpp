// register.cpp — 调用 DLL 自带的 DllRegisterServer / DllUnregisterServer
// 写入 HKCU（无需管理员），与 MarkFlow 之前的预览挂载方式一致。
#include <windows.h>
#include <stdio.h>

typedef HRESULT (WINAPI *DLLREGPROC)(void);

int wmain(int argc, wchar_t** argv) {
    bool unreg = (argc > 1 && (wcscmp(argv[1], L"/u") == 0 ||
                               wcscmp(argv[1], L"unregister") == 0));
    wchar_t path[MAX_PATH];
    if (!GetModuleFileNameW(NULL, path, MAX_PATH)) { wprintf(L"GetModuleFileName failed\n"); return 1; }
    wchar_t* p = wcsrchr(path, L'\\');
    if (p) wcscpy(p + 1, L"MarkFlowPreviewHandler.dll");

    HMODULE h = LoadLibraryW(path);
    if (!h) { wprintf(L"LoadLibrary failed (0x%08X): %ls\n", GetLastError(), path); return 1; }

    DLLREGPROC fn = (DLLREGPROC)GetProcAddress(h, unreg ? "DllUnregisterServer" : "DllRegisterServer");
    if (!fn) { wprintf(L"GetProcAddress failed: 0x%08X\n", GetLastError()); FreeLibrary(h); return 1; }

    HRESULT hr = fn();
    wprintf(unreg ? L"DllUnregisterServer -> 0x%08X\n" : L"DllRegisterServer -> 0x%08X\n", hr);
    FreeLibrary(h);
    if (SUCCEEDED(hr)) {
        wprintf(unreg ? L"已卸载 MarkFlow 预览处理器（HKCU）。\n"
                      : L"已注册 MarkFlow 预览处理器（HKCU）。\n");
        return 0;
    }
    wprintf(L"注册/卸载失败。\n");
    return 1;
}
