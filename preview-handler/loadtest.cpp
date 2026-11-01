// loadtest.cpp — 验证 DLL 能否被 LoadLibrary 加载、导出是否可达
#include <windows.h>
#include <stdio.h>
int wmain(int argc, wchar_t** argv) {
    if (argc < 2) { wprintf(L"usage: loadtest <dll>\n"); return 1; }
    HMODULE h = LoadLibraryW(argv[1]);
    wprintf(L"LoadLibraryW(%s) -> %p  (err=%lu)\n", argv[1], (void*)h, (unsigned long)GetLastError());
    if (!h) return 2;
    typedef HRESULT (__stdcall *Fn)(const CLSID&, const IID&, void**);
    Fn f = (Fn)GetProcAddress(h, "DllGetClassObject");
    wprintf(L"GetProcAddress(DllGetClassObject) -> %p\n", (void*)f);
    if (!f) return 3;
    CLSID clsid = {0x6F3A8C2B,0x1E4D,0x4B7A,{0x9C,0x5E,0x2D,0x8F,0x1A,0x0B,0x3C,0x4E}};
    IClassFactory* cf = NULL;
    HRESULT hr = f(clsid, __uuidof(IClassFactory), (void**)&cf);
    wprintf(L"DllGetClassObject -> 0x%08X  cf=%p\n", (unsigned long)hr, (void*)cf);
    if (cf) cf->Release();
    FreeLibraryAndExitThread(h, 0);
    return 0;
}
