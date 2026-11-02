#!/usr/bin/env bash
# Chép script kế toán tháng sang Mac mini — máy chạy crawler + ingest hằng tháng (mac-crawler/monthly_crawler.ts gọi
# <MAC_MINI_DIR>/scripts/ingest_monthly_from_raw.py). Mac mini giữ bản chép riêng, không tự lấy code từ git:
# quên chép thì crawler tháng sau chạy code cũ (2026-11-02: mất phí lưu kho, thiếu hàng ra kho, sai removal).
#
# Dùng: bash scripts/sync-mac-mini.sh
set -euo pipefail

MAC_MINI="${MAC_MINI:-ad@100.111.217.54}"
DEST="${MAC_MINI_DIR:-/Users/ad/mac-crawler}"
FILE=scripts/ingest_monthly_from_raw.py

cd "$(dirname "$0")/.."
ssh -o StrictHostKeyChecking=accept-new "$MAC_MINI" \
  "cp '$DEST/$FILE' '$DEST/$FILE.bak-$(date +%Y%m%d-%H%M%S)' 2>/dev/null || true"
scp "$FILE" "$MAC_MINI:$DEST/$FILE"
ssh "$MAC_MINI" "cmp -s /dev/stdin '$DEST/$FILE'" < "$FILE"
echo "✅ Mac mini đã có $FILE bản $(git log -1 --format=%h -- "$FILE")"
