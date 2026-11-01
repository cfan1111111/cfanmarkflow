// md2rtf_test.cpp — 独立校验 Markdown->RTF 转换器（不依赖 GUI / COM）。
// 用法：md2rtf_test.exe <in.md> <out.rtf>
#include "md2rtf.h"
#include <windows.h>
#include <cstdio>
#include <string>

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) { fwprintf(stderr, L"usage: md2rtf_test <in.md> <out.rtf>\n"); return 1; }
    FILE* f = _wfopen(argv[1], L"rb");
    if (!f) { fwprintf(stderr, L"cannot open input: %ls\n", argv[1]); return 1; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    std::string buf; buf.resize((size_t)sz);
    size_t rd = fread(&buf[0], 1, (size_t)sz, f); buf.resize(rd); fclose(f);

    std::wstring rtf = md2rtf::convert(buf);

    FILE* o = _wfopen(argv[2], L"wb");
    if (!o) { fwprintf(stderr, L"cannot open output: %ls\n", argv[2]); return 1; }
    unsigned short bom = 0xFEFF;
    fwrite(&bom, 2, 1, o);
    fwrite(rtf.data(), sizeof(wchar_t), rtf.size(), o);
    fclose(o);

    wprintf(L"OK: 输入 %zu 字节，输出 %zu 个 RTF 宽字符 -> %ls\n", rd, rtf.size(), argv[2]);
    return 0;
}
