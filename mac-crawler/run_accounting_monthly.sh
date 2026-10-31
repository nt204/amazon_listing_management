#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-accounting-monthly.log"

mkdir -p "$LOG_DIR"

if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TỰ ĐỘNG TẢI BÁO CÁO THÁNG (MONTHLY) BẮT ĐẦU"
echo "### Thời gian: $(date)"
echo "### Thư mục: $SCRIPT_DIR"
echo "######################################################################"

# 1. Chống Sleep: Dùng caffeinate để giữ Mac luôn thức trong suốt quá trình chạy
CAFFEINATE_PID=""
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w $$ &
  CAFFEINATE_PID=$!
  echo "[Power] Đã kích hoạt caffeinate (PID $CAFFEINATE_PID) ngăn Mac ngủ."
fi

cleanup() {
  if [ -n "$CAFFEINATE_PID" ]; then
    kill "$CAFFEINATE_PID" 2>/dev/null || true
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo -n purge 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 2. PATH & Node environment
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=2048 --dns-result-order=ipv4first $NODE_OPTIONS"

if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

if [ -f "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
elif command -v tsx >/dev/null 2>&1; then
  TSX_BIN="$(which tsx)"
else
  echo "[LỖI] Không tìm thấy tsx. Hãy chạy npm install trong $SCRIPT_DIR." >&2
  exit 1
fi

echo "[Environment] Node: $(which node)"
echo "[Environment] TSX: $TSX_BIN"

cd "$SCRIPT_DIR"
"$TSX_BIN" monthly_crawler.ts "$@"
EXIT_CODE=$?

echo ""
echo "### TIẾN TRÌNH TẢI BÁO CÁO THÁNG KẾT THÚC VỚI CODE: $EXIT_CODE"
echo "### Thời gian: $(date)"
echo "######################################################################"

exit $EXIT_CODE
