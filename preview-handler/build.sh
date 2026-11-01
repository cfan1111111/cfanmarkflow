#!/usr/bin/env bash
# 用 winlibs MinGW-w64 编译 MarkFlow 原生预览处理器（COM Shell 扩展）。
# 产物（自包含，只依赖系统 DLL）：
#   dist/MarkFlowPreviewHandler.dll   预览处理器本体
#   dist/register.exe                 注册/卸载（HKCU，无需管理员）
#   dist/test_host.exe                离线冒烟测试（模拟预览宿主）
#   dist/md2rtf_test.exe              转换器独立校验
#   dist/imeprobe.exe                 IME 压力测试（真实预览窗格输入注入）
set -e

# 工具链根目录（7z 解压后的 mingw64）
GCCDIR="D:/workbuddy/2026-10-23-08-57-29/toolchain/mingw64/bin"
GPP="$GCCDIR/g++.exe"
OUT="dist"
mkdir -p "$OUT"

COMMON="-static -static-libgcc -static-libstdc++ -O2 -Wall"
COMMON_EXE="$COMMON -municode"   # 支持 wmain / wWinMain 宽字符入口

# 1) 预览处理器 DLL（关键：-shared -Wl,--kill-at 导出未修饰名）
echo "[1/4] 编译 MarkFlowPreviewHandler.dll ..."
"$GPP" -shared $COMMON -Wl,--kill-at \
  -o "$OUT/MarkFlowPreviewHandler.dll" preview_handler.cpp md2rtf.cpp \
  -lkernel32 -luser32 -lgdi32 -ladvapi32 -limm32 -lole32 -luuid

# 2) 注册器
echo "[2/4] 编译 register.exe ..."
"$GPP" $COMMON_EXE -o "$OUT/register.exe" register.cpp -lkernel32 -luuid

# 3) 离线预览宿主测试
echo "[3/4] 编译 test_host.exe ..."
"$GPP" $COMMON_EXE -o "$OUT/test_host.exe" test_host.cpp -lkernel32 -lole32 -luuid -luser32

# 4) 转换器独立校验
echo "[4/5] 编译 md2rtf_test.exe ..."
"$GPP" $COMMON_EXE -o "$OUT/md2rtf_test.exe" md2rtf_test.cpp md2rtf.cpp -lkernel32

# 5) IME 压力测试（真实资源管理器预览窗格 + 输入法注入）
#    模式：list / deep / selfro / wubi / [pid]
echo "[5/5] 编译 imeprobe.exe ..."
"$GPP" $COMMON_EXE -std=c++17 -o "$OUT/imeprobe.exe" imeprobe.cpp \
  -lkernel32 -luser32 -lgdi32 -limm32 -ladvapi32

echo "完成。产物位于 $OUT/"
"$GPP" --version | head -1
