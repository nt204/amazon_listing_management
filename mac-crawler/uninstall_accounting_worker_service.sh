#!/bin/bash
set -e

LABEL="com.amazon.accounting.worker"
TARGET_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$TARGET_PLIST" ]; then
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
  rm -f "$TARGET_PLIST"
  echo "=> Đã dừng và gỡ Accounting Job Worker."
else
  echo "=> Không tìm thấy Accounting Job Worker."
fi
