#!/usr/bin/env bash
# M0 技术验证：命令行完成一次「卸载只读挂载 → 读写挂载 → 写入 → 卸载」
# 用法：sudo bash scripts/m0-poc.sh /dev/disk4s1
# 注意：务必使用闲置磁盘，写入测试会向卷根目录写入一个小文件。
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "该脚本仅支持 macOS" >&2
  exit 1
fi

DEV="${1:-}"
if [[ -z "$DEV" ]]; then
  echo "用法：sudo bash scripts/m0-poc.sh /dev/disk4s1" >&2
  echo
  diskutil list
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "未找到 Homebrew" >&2
  exit 1
fi

BREW_PREFIX="$(brew --prefix)"
NTFS3G="$BREW_PREFIX/bin/ntfs-3g"
if [[ ! -x "$NTFS3G" ]]; then
  echo "未找到 ntfs-3g，请先执行：brew install gromgit/fuse/ntfs-3g-mac" >&2
  exit 1
fi

echo "==> 卷信息"
diskutil info "$DEV" | grep -Ei "Device Node|Volume Name|File System Personality|Type \(Bundle\)|Mounted|Read-Only Volume" || true

NAME="$(diskutil info "$DEV" | awk -F: '/Volume Name/{gsub(/^[ \t]+/, "", $2); print $2}')"
MOUNT_POINT="/Volumes/${NAME:-NTFS4MAC-POC}"

echo
echo "==> 卸载系统只读挂载（如存在）"
sudo diskutil unmount "$DEV" >/dev/null 2>&1 || true

echo "==> 创建挂载点：$MOUNT_POINT"
sudo mkdir -p "$MOUNT_POINT"

echo "==> 以读写方式挂载（后台运行 ntfs-3g）"
sudo "$NTFS3G" "$DEV" "$MOUNT_POINT" -o local,allow_other,auto_xattr &
MOUNT_PID=$!

MOUNTED=0
for _ in $(seq 1 30); do
  if mount | grep -q "on ${MOUNT_POINT} "; then
    MOUNTED=1
    break
  fi
  sleep 0.5
done

if [[ "$MOUNTED" != "1" ]]; then
  echo "挂载失败，检查是否卷被休眠锁定或 macFUSE 未获批准" >&2
  kill "$MOUNT_PID" 2>/dev/null || true
  exit 1
fi

TEST_FILE="$MOUNT_POINT/ntfs4mac-poc-$(date +%s).txt"
echo "==> 写入测试文件：$TEST_FILE"
sudo sh -c "echo 'ntfs4mac poc' > '$TEST_FILE'"
sudo sync

echo "==> 卸载"
sudo diskutil unmount "$MOUNT_POINT" 2>/dev/null || sudo umount "$MOUNT_POINT"

cat <<EOF

完成。
1. 将磁盘接回 Windows，确认根目录存在：$(basename "$TEST_FILE")，内容为 ntfs4mac poc；
2. 在 Windows 上删除该文件；
3. 把结果填入 docs/M0-验证报告.md。
EOF
