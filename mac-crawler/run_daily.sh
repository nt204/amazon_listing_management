#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/mac-crawler.log"

mkdir -p "$LOG_DIR"

bash "$SCRIPT_DIR/maintenance.sh"

# Ghi nhận output ra đồng thời console và file log
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH TỰ ĐỘNG CRAWL & ĐỒNG BỘ AMAZON PPC BẮT ĐẦU"
echo "### Thời gian: $(date)"
echo "### Thư mục: $SCRIPT_DIR"
echo "######################################################################"

# 1. Chống Sleep: Dùng caffeinate để giữ Mac luôn thức trong suốt quá trình chạy
CAFFEINATE_PID=""
if command -v caffeinate >/dev/null 2>&1; then
  # Chỉ ngăn system idle sleep; không giữ màn hình và ổ đĩa thức vô ích.
  caffeinate -i -w $$ &
  CAFFEINATE_PID=$!
  echo "[Power] Đã kích hoạt caffeinate (PID $CAFFEINATE_PID) ngăn Mac ngủ trong lúc crawl."
fi

cleanup() {
  if [ -n "$CAFFEINATE_PID" ]; then
    kill "$CAFFEINATE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 2. Định vị binary Node & TSX & Python
NODE_BIN="$(which node || echo "/usr/local/bin/node")"
PYTHON_BIN="$(which python3 || echo "/usr/bin/python3")"

if [ ! -f "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  echo "[Node] Chưa có node_modules, đang tự động chạy npm install..."
  (cd "$SCRIPT_DIR" && npm install --silent)
fi

if [ -f "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
elif [ -f "$SCRIPT_DIR/../node_modules/.bin/tsx" ]; then
  TSX_BIN="$SCRIPT_DIR/../node_modules/.bin/tsx"
elif command -v tsx >/dev/null 2>&1; then
  TSX_BIN="$(which tsx)"
else
  TSX_BIN="npx tsx"
fi

# Load config
if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

echo "[Environment] Node: $NODE_BIN"
echo "[Environment] Python: $PYTHON_BIN"
echo "[Store] $STORE_NAME"

# ====================================================================
# BƯỚC 1: CRAWL DỮ LIỆU TỪ ADSPOWER QUA PLAYWRIGHT
# ====================================================================
echo ""
echo ">>> [BƯỚC 1/3] CRAWL 6 BÁO CÁO PPC VỀ MÁY MAC LOCAL..."
if [ -f "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then
  "$SCRIPT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/crawler.ts"
elif [ -f "$SCRIPT_DIR/../node_modules/.bin/tsx" ]; then
  "$SCRIPT_DIR/../node_modules/.bin/tsx" "$SCRIPT_DIR/crawler.ts"
elif command -v tsx >/dev/null 2>&1; then
  tsx "$SCRIPT_DIR/crawler.ts"
else
  npx tsx "$SCRIPT_DIR/crawler.ts"
fi

# crawler.ts chỉ publish marker sau khi đủ và xác minh đúng 6 file. Script
# Python vẫn giữ lại để retry thủ công các batch cũ, nhưng không upload lặp ở đây.
echo ""
echo ">>> [BƯỚC 2/3] BATCH ĐÃ ĐƯỢC KIỂM TRA VÀ PUBLISH LÊN R2..."

# ====================================================================
# BƯỚC 3: KÍCH HOẠT WEB APP ĐỒNG BỘ DỮ LIỆU TỪ R2 VÀO POSTGRESQL
# ====================================================================
echo ""
echo ">>> [BƯỚC 3/3] KÍCH HOẠT WEB APP ĐỒNG BỘ DỮ LIỆU VÀO DATABASE..."
SYNC_MAX_ATTEMPTS="${DB_SYNC_MAX_ATTEMPTS:-5}"
SYNC_ATTEMPT=1
until bash "$SCRIPT_DIR/trigger_sync.sh"; do
  if [ "$SYNC_ATTEMPT" -ge "$SYNC_MAX_ATTEMPTS" ]; then
    echo "[SYNC] Đã hết giới hạn $SYNC_MAX_ATTEMPTS lần đồng bộ. File trên R2 vẫn được giữ để retry sau."
    exit 1
  fi
  SYNC_DELAY=$((5 * (2 ** (SYNC_ATTEMPT - 1))))
  if [ "$SYNC_DELAY" -gt 60 ]; then SYNC_DELAY=60; fi
  echo "[SYNC] Lần $SYNC_ATTEMPT/$SYNC_MAX_ATTEMPTS thất bại; thử lại sau ${SYNC_DELAY}s..."
  sleep "$SYNC_DELAY"
  SYNC_ATTEMPT=$((SYNC_ATTEMPT + 1))
done

echo ""
echo "######################################################################"
echo "### TIẾN TRÌNH CRAWL VÀ ĐỒNG BỘ PPC ĐÃ HOÀN TẤT THÀNH CÔNG!"
echo "### Kết thúc lúc: $(date)"
echo "######################################################################"
echo ""

# Gửi thông báo Desktop macOS
osascript -e 'display notification "6 báo cáo Amazon PPC đã được tải và đồng bộ lên R2/Database thành công!" with title "Amazon PPC Crawler" sound name "Glass"' 2>/dev/null || true
