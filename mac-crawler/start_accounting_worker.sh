#!/bin/bash
# Khởi động worker nhận lệnh crawler kế toán từ web (System Admin → Crawler).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

if [ -x "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
elif command -v tsx >/dev/null 2>&1; then
  TSX_BIN="$(which tsx)"
else
  echo "[LỖI] Không tìm thấy tsx. Chạy 'npm install' trong $SCRIPT_DIR rồi cài lại worker." >&2
  exit 1
fi

echo "============================================================"
echo "KHỞI ĐỘNG ACCOUNTING JOB WORKER ($(date))"
echo "============================================================"
exec "$TSX_BIN" "$SCRIPT_DIR/accounting_job_worker.ts"
