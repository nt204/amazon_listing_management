#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-inventory.log"

mkdir -p "$LOG_DIR"

# Ghi nhận output đồng thời ra console và file log
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TỰ ĐỘNG TẢI BÁO CÁO TỒN KHO (INVENTORY LEDGER) BẮT ĐẦU"
echo "### Thời gian: $(date)"
echo "### Thư mục: $SCRIPT_DIR"
echo "######################################################################"

# 1. Chống Sleep: Dùng caffeinate để giữ Mac luôn thức trong suốt quá trình chạy
CAFFEINATE_PID=""
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w $$ &
  CAFFEINATE_PID=$!
  echo "[Power] Đã kích hoạt caffeinate (PID $CAFFEINATE_PID) ngăn Mac ngủ trong lúc tải báo cáo."
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

# 3. Chạy crawler
#    - Có tham số (--date / --store, do worker hoặc người chạy tay): chạy đúng như yêu cầu.
#    - Lịch launchd: ngày {MONTH_END_RUN_DAY:-4} hằng tháng → chốt tồn NGÀY CUỐI THÁNG TRƯỚC (30/31/28/29; tới ngày 4 Amazon
#      chắc chắn đã có báo cáo — chạy ngày 1 thì bên Mỹ vẫn đang là ngày cuối tháng, file tải về rỗng).
#      Ngày chạy tuần (thứ 1 theo `date +%u`) → tồn thứ 7 tuần trước. Trùng cả hai thì chạy cả hai.
if [ "$#" -gt 0 ]; then
  "$TSX_BIN" "$SCRIPT_DIR/inventory_crawler.ts" "$@"
else
  MONTH_END_RUN_DAY="${MONTH_END_RUN_DAY:-4}"
  WEEKLY_RUN_WEEKDAY="${WEEKLY_RUN_WEEKDAY:-1}"
  RAN=0
  if [ "$((10#$(date +%d)))" -eq "$MONTH_END_RUN_DAY" ]; then
    MONTH_END="$(date -v1d -v-1d +%Y-%m-%d)"
    echo "[Lịch] Ngày $MONTH_END_RUN_DAY → chốt tồn cuối tháng $MONTH_END"
    "$TSX_BIN" "$SCRIPT_DIR/inventory_crawler.ts" "--date=$MONTH_END"
    RAN=1
  fi
  if [ "$(date +%u)" = "$WEEKLY_RUN_WEEKDAY" ] || [ "$RAN" -eq 0 ]; then
    echo "[Lịch] Chạy tồn tuần (thứ 7 tuần trước)"
    "$TSX_BIN" "$SCRIPT_DIR/inventory_crawler.ts"
  fi
fi

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TẢI BÁO CÁO TỒN KHO ĐÃ HOÀN TẤT THÀNH CÔNG!"
echo "### Kết thúc lúc: $(date)"
echo "######################################################################"
echo ""

osascript -e 'display notification "Báo cáo Tồn kho Inventory Ledger đã được chốt và nạp database thành công!" with title "Inventory Crawler" sound name "Glass"' 2>/dev/null || true
