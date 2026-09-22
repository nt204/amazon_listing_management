#!/bin/bash
set -e

echo "============================================================"
echo "XÓA TOÀN BỘ JOB RESUME & CHECKPOINT CŨ TRÊN MÁY MAC"
echo "============================================================"

# 1. Dừng worker tạm thời
pkill -9 -f remote_worker 2>/dev/null || true

# 2. Xóa toàn bộ file checkpoint job local
CHECKPOINT_DIR="$HOME/Library/Application Support/AmazonPpcCrawler"
if [ -d "$CHECKPOINT_DIR" ]; then
  rm -rf "$CHECKPOINT_DIR"/*
  echo "[OK] Đã xóa toàn bộ checkpoint trong $CHECKPOINT_DIR"
fi

# 3. Xóa các file log cũ nếu cần
rm -f "$HOME/Library/Logs"/mac-crawler*.log* 2>/dev/null || true
echo "[OK] Đã dọn sạch log cũ."

echo "============================================================"
echo "=> ĐÃ XÓA SẠCH TOÀN BỘ JOB RESUME!"
echo "Lần chạy tiếp theo sẽ bắt đầu lại hoàn toàn mới từ con số 0 (Fresh Crawl)."
echo "============================================================"
