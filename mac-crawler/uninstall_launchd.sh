#!/bin/bash
set -e

PLIST_NAME="com.amazon.ppc.crawler.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "============================================================"
echo "HỦY KÍCH HOẠT LỊCH TỰ ĐỘNG CRAWL TRÊN MAC"
echo "============================================================"

if [ -f "$TARGET_PLIST" ]; then
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
  rm -f "$TARGET_PLIST"
  echo "=> Đã gỡ bỏ $TARGET_PLIST thành công."
else
  echo "=> Không tìm thấy file LaunchAgent."
fi
echo "============================================================"
