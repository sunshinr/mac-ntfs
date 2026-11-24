#!/usr/bin/env bash
# 编译 dar-monitor（磁盘事件）与 NTFS4MacHelper（特权助手）
# 用法：
#   bash scripts/build-helper.sh                      仅编译
#   sudo bash scripts/build-helper.sh --install       编译并安装 LaunchDaemon
#   CODESIGN_IDENTITY="Developer ID Application: xxx" bash scripts/build-helper.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/helper/build"
INSTALL_ROOT="/usr/local/libexec/ntfs4mac"
PLIST_SRC="$ROOT/helper/NTFS4MacHelper/com.ntfs4mac.helper.plist"
PLIST_DST="/Library/LaunchDaemons/com.ntfs4mac.helper.plist"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "该脚本仅支持 macOS" >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "未找到 swiftc，请先安装 Xcode Command Line Tools：xcode-select --install" >&2
  exit 1
fi

mkdir -p "$OUT"

echo "==> 编译 dar-monitor"
swiftc -O -o "$OUT/dar-monitor" "$ROOT/helper/dar-monitor/main.swift" \
  -framework DiskArbitration -framework Foundation

echo "==> 编译 NTFS4MacHelper"
swiftc -O -o "$OUT/NTFS4MacHelper" "$ROOT"/helper/NTFS4MacHelper/*.swift -framework Foundation

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  echo "==> 使用证书签名：$CODESIGN_IDENTITY"
  codesign --force --options runtime --timestamp --sign "$CODESIGN_IDENTITY" \
    "$OUT/dar-monitor" "$OUT/NTFS4MacHelper"
else
  echo "==> 未提供 CODESIGN_IDENTITY，跳过签名（打包分发前必须签名）"
fi

if [[ "${1:-}" == "--install" ]]; then
  if [[ "$(id -u)" != "0" ]]; then
    echo "安装需要 root：sudo bash scripts/build-helper.sh --install" >&2
    exit 1
  fi

  echo "==> 安装到 $INSTALL_ROOT"
  mkdir -p "$INSTALL_ROOT" /var/log/ntfs4mac /var/run/ntfs4mac
  chmod 755 /var/log/ntfs4mac /var/run/ntfs4mac
  install -m 755 -o root -g wheel "$OUT/NTFS4MacHelper" "$INSTALL_ROOT/NTFS4MacHelper"
  install -m 755 -o root -g wheel "$OUT/dar-monitor" "$INSTALL_ROOT/dar-monitor"
  install -m 644 -o root -g wheel "$PLIST_SRC" "$PLIST_DST"

  echo "==> 重新加载 LaunchDaemon"
  launchctl bootout system "$PLIST_DST" >/dev/null 2>&1 || true
  launchctl bootstrap system "$PLIST_DST"
  launchctl enable system/com.ntfs4mac.helper

  sleep 1
  if [[ -S /var/run/ntfs4mac/helper.sock ]]; then
    echo "==> 安装完成，socket 已就绪：/var/run/ntfs4mac/helper.sock"
  else
    echo "==> 安装完成，但 socket 未就绪，请查看 /var/log/ntfs4mac/helper.log" >&2
  fi
fi

echo
echo "产物：$OUT"
