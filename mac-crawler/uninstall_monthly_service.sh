#!/bin/bash
set -e

PLIST_NAME="com.amazon.ketoan.monthly.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

echo "Đang gỡ bỏ dịch vụ tải báo cáo tháng tự động..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
rm -f "$TARGET_PLIST"

echo "✅ Đã gỡ bỏ dịch vụ $PLIST_NAME thành công!"
