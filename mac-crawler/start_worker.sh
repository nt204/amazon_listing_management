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

TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
if [ ! -f "$TSX_BIN" ]; then
  TSX_BIN="$SCRIPT_DIR/../node_modules/.bin/tsx"
fi
if [ ! -f "$TSX_BIN" ]; then
  TSX_BIN="$(which tsx || echo "npx tsx")"
fi

echo "============================================================"
echo "KHỞI ĐỘNG CRAWLER REMOTE WORKER TRÊN MAC MINI"
echo "Log file: $LOG_FILE"
if command -v caffeinate >/dev/null 2>&1; then
  echo "[Power] Kích hoạt caffeinate (-s -i -m): Giữ CPU & Mạng luôn thức để nhận lệnh từ Server (cho phép màn hình tắt tiết kiệm điện)."
  exec caffeinate -s -i -m "$TSX_BIN" "$SCRIPT_DIR/remote_worker.ts" >> "$LOG_FILE" 2>&1
else
  exec "$TSX_BIN" "$SCRIPT_DIR/remote_worker.ts" >> "$LOG_FILE" 2>&1
fi
