#!/bin/bash
set -e

PLIST_NAME="com.amazon.inventory.crawler.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "Đang gỡ bỏ dịch vụ tự động crawl tồn kho..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
rm -f "$TARGET_PLIST"

echo "✅ Đã gỡ bỏ thành công dịch vụ crawl tồn kho."
