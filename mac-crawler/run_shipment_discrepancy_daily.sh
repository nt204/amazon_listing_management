#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-shipment-discrepancy.log"

mkdir -p "$LOG_DIR"

if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TỰ ĐỘNG QUÉT SHIPMENT DISCREPANCY SELLER CENTRAL BẮT ĐẦU"
echo "### Thời gian: $(date)"
echo "### Thư mục: $SCRIPT_DIR"
echo "######################################################################"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

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
}
trap cleanup EXIT

cd "$SCRIPT_DIR"

# Nếu truyền tham số store (ví dụ: FASTPEACE) thì chạy store đó.
# Nếu không truyền gì (launchd gọi 02:00 sáng hằng ngày) thì 3 ngày mới quét 1 lần (ngày trong năm chia hết cho 3),
# chạy --all cho tất cả các store và gửi Telegram tổng hợp. Chạy tay có tham số store thì luôn chạy.
# Ép chạy ngay cả ngày bị bỏ qua: FORCE=1 bash run_shipment_discrepancy_daily.sh
if [ -n "$1" ]; then
  echo "[Runner] Chạy quét riêng cho Store: $1..."
  npx tsx shipment_discrepancy_crawler.ts --store "$1"
else
  DAY_OF_YEAR=$((10#$(date +%j)))
  if [ "${FORCE:-0}" != "1" ] && [ $((DAY_OF_YEAR % 3)) -ne 0 ]; then
    echo "[Runner] Hôm nay (ngày $DAY_OF_YEAR) không tới lượt — 3 ngày quét 1 lần. Bỏ qua."
    exit 0
  fi
  echo "[Runner] Chạy quét toàn bộ TẤT CẢ các store (--all)..."
  npx tsx shipment_discrepancy_crawler.ts --all
fi

echo "[Runner] Hoàn thành lúc: $(date)"
