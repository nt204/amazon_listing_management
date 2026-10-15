#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-accounting.log"

mkdir -p "$LOG_DIR"

# Ghi nhận output ra đồng thời console và file log
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TỰ ĐỘNG TẢI BÁO CÁO KẾ TOÁN SELLER CENTRAL BẮT ĐẦU"
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

# Kế toán lưu riêng khỏi PPC: dọn report cũ và kiểm tra dung lượng trước khi mở profile.
ACCOUNTING_DOWNLOAD_DIR="${ACCOUNTING_DOWNLOAD_DIR:-$HOME/AmazonAccounting/downloads}"
ACCOUNTING_LOCAL_RETENTION_DAYS="${ACCOUNTING_LOCAL_RETENTION_DAYS:-30}"
ACCOUNTING_MIN_FREE_DISK_GB="${ACCOUNTING_MIN_FREE_DISK_GB:-10}"
mkdir -p "$ACCOUNTING_DOWNLOAD_DIR"

case "$ACCOUNTING_DOWNLOAD_DIR" in
  /|"$HOME"|"$HOME"/|"")
    echo "[LỖI] ACCOUNTING_DOWNLOAD_DIR không an toàn: $ACCOUNTING_DOWNLOAD_DIR" >&2
    exit 1
    ;;
esac

find "$ACCOUNTING_DOWNLOAD_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$ACCOUNTING_LOCAL_RETENTION_DAYS" -exec rm -rf -- {} + 2>/dev/null || true
available_kb="$(df -Pk "$ACCOUNTING_DOWNLOAD_DIR" | awk 'NR==2 {print $4}')"
required_kb=$((ACCOUNTING_MIN_FREE_DISK_GB * 1024 * 1024))
if [ -z "$available_kb" ] || [ "$available_kb" -lt "$required_kb" ]; then
  echo "[DISK GUARD] Cần tối thiểu ${ACCOUNTING_MIN_FREE_DISK_GB}GB trống tại $ACCOUNTING_DOWNLOAD_DIR." >&2
  exit 1
fi
echo "[DISK GUARD] Dọn report cũ hơn ${ACCOUNTING_LOCAL_RETENTION_DAYS} ngày; dung lượng trống đủ."

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

# Uploader chỉ đồng bộ batch vừa chạy; không quét lại toàn bộ lịch sử mỗi ngày.
ACCOUNTING_RUN_DATE=""
for arg in "$@"; do
  case "$arg" in
    --date=*) ACCOUNTING_RUN_DATE="${arg#--date=}" ;;
  esac
done
if [ -z "$ACCOUNTING_RUN_DATE" ]; then
  ACCOUNTING_RUN_DATE="$(node -e '
const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
const get = (type) => Number(parts.find((part) => part.type === type).value);
const target = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
target.setUTCDate(target.getUTCDate() - (get("hour") < 15 ? 2 : 1));
process.stdout.write(target.toISOString().slice(0, 10));
')"
fi

# 3. Thực thi pipeline tải file kế toán bằng Playwright
"$TSX_BIN" "$SCRIPT_DIR/accounting_crawler.ts" "$@"

# 4. Tự động đồng bộ file kế toán lên Cloudflare R2 để hiển thị trên Web Dashboard
if [ -f "$SCRIPT_DIR/upload_accounting_r2.ts" ]; then
  echo ""
  echo ">>> [Cloudflare R2] Bắt đầu đồng bộ file kế toán lên Cloud Storage..."
  "$TSX_BIN" "$SCRIPT_DIR/upload_accounting_r2.ts" "--date=$ACCOUNTING_RUN_DATE" || echo "⚠️ Đồng bộ R2 gặp lỗi, file vẫn được lưu an toàn tại máy Mac."
fi

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TẢI BÁO CÁO KẾ TOÁN ĐÃ HOÀN TẤT THÀNH CÔNG!"
echo "### Kết thúc lúc: $(date)"
echo "######################################################################"
echo ""

osascript -e 'display notification "Báo cáo Kế toán Seller Central đã được tải về máy thành công!" with title "Accounting Crawler" sound name "Glass"' 2>/dev/null || true
