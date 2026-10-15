#!/bin/bash
set -e

PLIST_NAME="com.amazon.ketoan.crawler.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "Đang gỡ bỏ dịch vụ tự động tải file Kế toán..."
launchctl bootout "gui/$(id -u)/com.amazon.ketoan.crawler" 2>/dev/null || launchctl unload "$TARGET_PLIST" 2>/dev/null || true
rm -f "$TARGET_PLIST"

echo "✅ Đã gỡ bỏ thành công service com.amazon.ketoan.crawler."
