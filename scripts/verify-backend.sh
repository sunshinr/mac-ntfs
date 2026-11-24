#!/usr/bin/env bash
# 环境自检：只做只读探测，不修改任何磁盘状态
set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "该脚本仅支持 macOS" >&2
  exit 1
fi

line() { printf '%-22s' "$1"; }

echo "========== 系统 =========="
line "macOS:"; sw_vers -productVersion 2>/dev/null || echo "未知"
line "芯片:"; uname -m
line "型号:"; sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "未知"
line "SIP:"; csrutil status 2>/dev/null | sed 's/System Integrity Protection status: //' || echo "未知"

echo
echo "========== 依赖 =========="
if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="$(brew --prefix)"
  line "Homebrew 前缀:"; echo "$BREW_PREFIX"
else
  BREW_PREFIX=""
  line "Homebrew 前缀:"; echo "未安装"
fi

if [[ -n "$BREW_PREFIX" && -x "$BREW_PREFIX/bin/ntfs-3g" ]]; then
  line "ntfs-3g:"; echo "$("$BREW_PREFIX/bin/ntfs-3g" --version 2>&1 | head -n 1)"
else
  line "ntfs-3g:"; echo "未安装（brew install gromgit/fuse/ntfs-3g-mac）"
fi

if [[ -d /Library/Filesystems/macfuse.fs ]]; then
  line "macFUSE:"; echo "$(defaults read /Library/Filesystems/macfuse.fs/Contents/Info CFBundleVersion 2>/dev/null || echo 已安装)"
else
  line "macFUSE:"; echo "未安装（brew install --cask macfuse）"
fi

line "kext 状态:"; kmutil showloaded --list-only 2>/dev/null | grep -i fuse || echo "未加载 / 无 kext 后端"

echo
echo "========== 特权助手 =========="
line "socket:"; ls -l /var/run/ntfs4mac/helper.sock 2>/dev/null || echo "未运行（将回退到管理员授权弹窗）"
line "LaunchDaemon:"; ls -l /Library/LaunchDaemons/com.ntfs4mac.helper.plist 2>/dev/null || echo "未安装"

echo
echo "========== 磁盘 =========="
diskutil list

echo
echo "提示：M0 验证请使用 scripts/m0-poc.sh，务必使用闲置磁盘。"
