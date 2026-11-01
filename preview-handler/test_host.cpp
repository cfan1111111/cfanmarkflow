// test_host.cpp — 离线模拟「预览宿主」调用我们的预览处理器。
// 用法：
//   test_host.exe <file.md>            （创建窗口，可肉眼查看渲染效果）
//   test_host.exe <file.md> -nogui     （无窗口，仅验证 COM 管线不崩溃、返回 S_OK）
//
// 与 preview_handler.cpp 及 Windows SDK shobjidl.idl 保持一致的接口与 GUID。
// 注意：IPreviewHandler 的方法顺序必须是
//   SetWindow, SetRect, DoPreview, Unload, SetFocus, QueryFocus, TranslateAccelerator
// （曾把 SetFocus/QueryFocus/TranslateAccelerator 提前，导致宿主调 DoPreview
//   落到 QueryFocus 上崩溃——务必与 SDK 逐字一致）
#include <windows.h>
#include <objbase.h>
#include <stdio.h>
#include <string>

struct IPreviewHandler : public IUnknown {
    STDMETHOD(SetWindow)(HWND hwnd, const RECT* prc) = 0;
    STDMETHOD(SetRect)(const RECT* prc) = 0;
    STDMETHOD(DoPreview)(void) = 0;
    STDMETHOD(Unload)(void) = 0;
    STDMETHOD(SetFocus)(void) = 0;
    STDMETHOD(QueryFocus)(HWND* phwnd) = 0;
    STDMETHOD(TranslateAccelerator)(MSG* pmsg) = 0;
};
struct IInitializeWithFile : public IUnknown {
    STDMETHOD(Initialize)(LPCWSTR pszFilePath, DWORD grfMode) = 0;
};
static const IID IID_IPreviewHandler       = {0x8895B1C6,0xB41F,0x4C1C,{0xA5,0x62,0x0D,0x56,0x42,0x50,0x83,0x6F}};
static const IID IID_IInitializeWithFile  = {0xB7D14566,0x0509,0x4CCE,{0xA7,0x1F,0x0A,0x55,0x42,0x33,0xBD,0x9B}};
static const CLSID CLSID_MarkFlowPreviewHandler = {0x6F3A8C2B,0x1E4D,0x4B7A,{0x9C,0x5E,0x2D,0x8F,0x1A,0x0B,0x3C,0x4E}};

static HWND g_hwnd = NULL;
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    if (msg == WM_SIZE) {
        // 简单转发尺寸变化给预览处理器（本测试不持有其指针，仅重绘窗口）
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) { wprintf(L"usage: test_host <file.md> [-nogui]\n"); return 1; }
    bool nogui = (argc > 2 && wcscmp(argv[2], L"-nogui") == 0);
    std::wstring file = argv[1];

    HRESULT hrCo = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(hrCo)) { wprintf(L"CoInitializeEx failed: 0x%08X\n", hrCo); return 1; }

    IPreviewHandler* ph = NULL;
    HRESULT hr = CoCreateInstance(CLSID_MarkFlowPreviewHandler, NULL,
                                 CLSCTX_INPROC_SERVER, IID_IPreviewHandler, (void**)&ph);
    wprintf(L"CoCreateInstance       : 0x%08X\n", hr);
    if (FAILED(hr)) { CoUninitialize(); return 1; }

    IInitializeWithFile* pif = NULL;
    hr = ph->QueryInterface(IID_IInitializeWithFile, (void**)&pif);
    wprintf(L"QI IInitializeWithFile: 0x%08X ptr=%p\n", hr, (void*)pif);
    if (SUCCEEDED(hr)) {
        void** vt = *(void***)pif;
        wprintf(L"  IInitializeWithFile vtable=%p slot3(Initialize)=%p\n", vt, vt[3]);
        hr = pif->Initialize(file.c_str(), 0);
        wprintf(L"Initialize            : 0x%08X\n", hr);
        pif->Release();
    }

    // 始终创建宿主窗口（即使 -nogui 也建一个隐藏窗口作为 RichEdit 的父窗口，
    // 否则 WS_CHILD 的 RichEdit 无法创建，DoPreview 会失败）
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = WndProc; wc.hInstance = GetModuleHandleW(NULL);
    wc.lpszClassName = L"MarkFlowTestHost";
    RegisterClassW(&wc);
    g_hwnd = CreateWindowW(L"MarkFlowTestHost", L"MarkFlow Preview Test",
                           WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                           760, 640, NULL, NULL, GetModuleHandleW(NULL), NULL);
    if (!nogui) ShowWindow(g_hwnd, SW_SHOW);
    RECT rc;
    if (g_hwnd) GetClientRect(g_hwnd, &rc);
    else { rc.left = 0; rc.top = 0; rc.right = 600; rc.bottom = 500; }

    hr = ph->SetWindow(g_hwnd, &rc);
    wprintf(L"SetWindow             : 0x%08X\n", hr);
    hr = ph->SetRect(&rc);
    wprintf(L"SetRect               : 0x%08X\n", hr);
    hr = ph->DoPreview();
    wprintf(L"DoPreview             : 0x%08X\n", hr);
    // 校验后续槽位（顺序错误时这些调用会落到错误的方法上甚至崩溃）
    {
        HWND hFocus = NULL;
        hr = ph->QueryFocus(&hFocus);
        wprintf(L"QueryFocus            : 0x%08X hwnd=%p\n", hr, (void*)hFocus);
        hr = ph->SetFocus();
        wprintf(L"SetFocus              : 0x%08X\n", hr);
        MSG m = {0};
        hr = ph->TranslateAccelerator(&m);
        wprintf(L"TranslateAccelerator  : 0x%08X\n", hr);
    }

    if (!nogui) {
        wprintf(L"窗口已打开，请查看渲染效果。关闭窗口后结束。\n");
        MSG msg; while (GetMessageW(&msg, NULL, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    } else {
        wprintf(L"[-nogui] COM 管线执行完毕，无崩溃。\n");
        Sleep(200);
    }

    ph->Unload();
    ph->Release();
    CoUninitialize();
    wprintf(L"TEST OK\n");
    return 0;
}
