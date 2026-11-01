// vtable_probe.cpp — 诊断用：打印预览处理器各虚函数的实际槽位映射，
// 用于核对「自声明接口」与「真实 Windows SDK」是否一致。
//
// 做法：直接从 CoCreateInstance 得到的对象上取 vtable 指针，
//       逐槽位打印函数地址，并与我们实现的成员函数地址比对。
#include <windows.h>
#include <objbase.h>
#include <stdio.h>
#include <string>

struct IPreviewHandler : public IUnknown {
    STDMETHOD(SetWindow)(HWND hwnd, const RECT* prc) = 0;
    STDMETHOD(SetFocus)(void) = 0;
    STDMETHOD(QueryFocus)(HWND* phwnd) = 0;
    STDMETHOD(TranslateAccelerator)(MSG* pmsg) = 0;
    STDMETHOD(SetRect)(const RECT* prc) = 0;
    STDMETHOD(DoPreview)(void) = 0;
    STDMETHOD(Unload)(void) = 0;
};
struct IInitializeWithFile : public IUnknown {
    STDMETHOD(Initialize)(LPCWSTR pszFilePath, DWORD grfMode) = 0;
};
static const IID IID_IPreviewHandler      = {0x8895B1C6,0xB41F,0x4C1C,{0xA5,0x62,0x0D,0x56,0x42,0x50,0x83,0x6F}};
static const IID IID_IInitializeWithFile = {0xB7D14566,0x0509,0x4CCE,{0xA7,0x1F,0x0A,0x55,0x42,0x33,0xBD,0x9B}};
static const CLSID CLSID_MarkFlowPreviewHandler = {0x6F3A8C2B,0x1E4D,0x4B7A,{0x9C,0x5E,0x2D,0x8F,0x1A,0x0B,0x3C,0x4E}};

static void dump(const wchar_t* tag, void* obj, int n) {
    void** vt = *(void***)obj;
    wprintf(L"\n--- %s : vtable=%p ---\n", tag, vt);
    for (int i = 0; i < n; i++) {
        wprintf(L"  slot %2d : %p\n", i, vt[i]);
    }
}

int wmain(int argc, wchar_t** argv) {
    (void)argc; (void)argv;
    HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) { wprintf(L"CoInitializeEx failed\n"); return 1; }

    IPreviewHandler* ph = NULL;
    hr = CoCreateInstance(CLSID_MarkFlowPreviewHandler, NULL, CLSCTX_INPROC_SERVER,
                          IID_IPreviewHandler, (void**)&ph);
    wprintf(L"CoCreateInstance: 0x%08X\n", (unsigned long)hr);
    if (FAILED(hr)) return 1;

    dump(L"IPreviewHandler", ph, 10);

    IInitializeWithFile* pif = NULL;
    hr = ph->QueryInterface(IID_IInitializeWithFile, (void**)&pif);
    wprintf(L"\nQI IInitializeWithFile: 0x%08X ptr=%p\n", (unsigned long)hr, (void*)pif);
    if (SUCCEEDED(hr)) {
        dump(L"IInitializeWithFile", pif, 4);
        wprintf(L"sizeof(IInitializeWithFile*)=%zu\n", sizeof(pif));
    }

    // 直接调用 Initialize，看是否进入我们的实现（文件不存在时 readFileUtf8 会返回空）
    hr = pif->Initialize(L"Z:\\__nonexistent_probe__.md", 0);
    wprintf(L"\nInitialize returned 0x%08X\n", (unsigned long)hr);

    ph->Release();
    CoUninitialize();
    return 0;
}
