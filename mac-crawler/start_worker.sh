#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-crawler-worker.log"

mkdir -p "$LOG_DIR"

bash "$SCRIPT_DIR/maintenance.sh"

if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

if [ ! -f "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  echo "[Setup] Chưa có node_modules, đang tự động cài đặt thư viện..."
  npm install --silent 2>/dev/null || true
fi

if [ -x "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  RUN_CMD=("$SCRIPT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/remote_worker.ts")
elif command -v tsx >/dev/null 2>&1; then
  RUN_CMD=("$(which tsx)" "$SCRIPT_DIR/remote_worker.ts")
else
  echo "[LỖI] Không tìm thấy tsx. Chạy 'npm install' trong $SCRIPT_DIR rồi cài lại worker." >&2
  exit 1
fi

echo "============================================================"
echo "KHỞI ĐỘNG CRAWLER REMOTE WORKER TRÊN MAC MINI"
echo "Log file: $LOG_FILE"
echo "============================================================"

if command -v caffeinate >/dev/null 2>&1; then
  echo "[Power] Kích hoạt caffeinate (-s -i -m): Giữ CPU & Mạng luôn thức để nhận lệnh từ Server."
  exec caffeinate -s -i -m "${RUN_CMD[@]}" >> "$LOG_FILE" 2>&1
else
  exec "${RUN_CMD[@]}" >> "$LOG_FILE" 2>&1
fi
