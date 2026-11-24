#!/usr/bin/env bash
# 安装运行时依赖：macFUSE（外部安装）+ ntfs-3g（用户态引擎）
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "该脚本仅支持 macOS" >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "未找到 Homebrew，请先安装：https://brew.sh" >&2
  exit 1
fi

echo "==> 安装 macFUSE（需要重启并在系统设置中允许系统扩展）"
brew install --cask macfuse

echo "==> 安装 ntfs-3g（用户态引擎）"
brew install gromgit/fuse/ntfs-3g-mac

BREW_PREFIX="$(brew --prefix)"
echo
echo "==> 安装结果"
echo "Homebrew 前缀: $BREW_PREFIX"
echo "ntfs-3g: $("$BREW_PREFIX/bin/ntfs-3g" --version 2>&1 | head -n 1)"
if [[ -d /Library/Filesystems/macfuse.fs ]]; then
  echo "macFUSE: 已安装 /Library/Filesystems/macfuse.fs"
else
  echo "macFUSE: 未检测到，请确认安装完成并重启" >&2
fi

cat <<'EOF'

后续步骤：
1. 重启 macOS；
2. 打开“系统设置 → 隐私与安全性”，允许 macFUSE 的系统软件；
3. Apple 芯片：关机后长按电源键进入恢复模式，将“降低安全性”设为允许用户管理内核扩展；
4. 运行 bash scripts/verify-backend.sh 确认环境。
EOF
