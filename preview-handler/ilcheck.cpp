// ilcheck.cpp <pid> - print the integrity level of a process by opening its token.
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

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
    if (argc < 2) { printf("usage: ilcheck <pid> [pid...]\n"); return 1; }
    for (int i = 1; i < argc; i++) {
        DWORD pid = (DWORD)strtoul(argv[i], NULL, 10);
        HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!h) { printf("pid %-8lu : OpenProcess failed err=%lu\n", pid, GetLastError()); continue; }
        HANDLE tok = NULL;
        if (!OpenProcessToken(h, TOKEN_QUERY, &tok)) {
            printf("pid %-8lu : OpenProcessToken failed err=%lu\n", pid, GetLastError());
            CloseHandle(h); continue;
        }
        DWORD len = 0;
        GetTokenInformation(tok, TokenIntegrityLevel, NULL, 0, &len);
        BYTE* buf = (BYTE*)malloc(len ? len : 64);
        DWORD rid = 0xFFFF;
        if (GetTokenInformation(tok, TokenIntegrityLevel, buf, len, &len)) {
            TOKEN_MANDATORY_LABEL* tml = (TOKEN_MANDATORY_LABEL*)buf;
            PUCHAR cnt = GetSidSubAuthorityCount(tml->Label.Sid);
            if (cnt && *cnt > 0) rid = *GetSidSubAuthority(tml->Label.Sid, 0);
        }
        // also grab the image name
        char path[MAX_PATH] = "?";
        DWORD n = MAX_PATH;
        QueryFullProcessImageNameA(h, 0, path, &n);
        printf("pid %-8lu : %-14s (0x%04X)  %s\n", pid, ilName(rid), (unsigned int)rid, path);
        free(buf);
        CloseHandle(tok);
        CloseHandle(h);
    }
    return 0;
}
