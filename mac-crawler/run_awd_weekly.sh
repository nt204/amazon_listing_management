#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-awd-inventory.log"

mkdir -p "$LOG_DIR"

# Ghi nhận output đồng thời ra console và file log
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TỰ ĐỘNG TẢI BÁO CÁO TỒN KHO AWD (AWD INVENTORY LEDGER) BẮT ĐẦU"
echo "### Thời gian: $(date)"
echo "### Thư mục: $SCRIPT_DIR"
echo "######################################################################"

# 1. Chống Sleep: Dùng caffeinate để giữ Mac luôn thức trong suốt quá trình chạy
CAFFEINATE_PID=""
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w $$ &
  CAFFEINATE_PID=$!
  echo "[Power] Đã kích hoạt caffeinate (PID $CAFFEINATE_PID) ngăn Mac ngủ trong lúc tải báo cáo AWD."
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

ACCOUNTING_DOWNLOAD_DIR="${ACCOUNTING_DOWNLOAD_DIR:-$HOME/AmazonAccounting/downloads}"
mkdir -p "$ACCOUNTING_DOWNLOAD_DIR"

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

# 3. Chạy crawler tồn kho AWD
"$TSX_BIN" "$SCRIPT_DIR/awd_inventory_crawler.ts" "$@"

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TẢI BÁO CÁO TỒN KHO AWD ĐÃ HOÀN TẤT THÀNH CÔNG!"
echo "### Kết thúc lúc: $(date)"
echo "######################################################################"
echo ""

osascript -e 'display notification "Báo cáo Tồn kho AWD Inventory Ledger đã được chốt và nạp database thành công!" with title "AWD Inventory Crawler" sound name "Glass"' 2>/dev/null || true
