#!/bin/bash
# Chạy bù crawler kế toán: store nào trong stores.json còn THIẾU đơn hàng hoặc chi phí Ads của ngày chốt sổ
# thì chạy lại riêng store đó (run_accounting_daily.sh --store=X --date=D).
# - Đang có crawler kế toán chạy (đợt 16:10 hoặc lần chạy bù khác) → bỏ qua, lần sau chạy tiếp.
# - Cron gợi ý: 40 18 * * * và 40 21 * * * (sau đợt chính 16:10).
# - Dùng tay: bash run_accounting_catchup.sh [--date=YYYY-MM-DD]
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$HOME/Library/Logs/mac-accounting.log"
mkdir -p "$(dirname "$LOG_FILE")"
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

echo ""
echo "### [Catch-up] $(date): kiểm tra store thiếu số liệu kế toán"

if pgrep -f "accounting_crawler.ts" >/dev/null 2>&1; then
  echo "[Catch-up] Đang có crawler kế toán chạy → bỏ qua lần này."
  exit 0
fi

# Ngày chốt sổ: giống run_accounting_daily.sh (sau 15h giờ VN = hôm qua, trước 15h = hôm kia)
RUN_DATE=""
for arg in "$@"; do
  case "$arg" in
    --date=*) RUN_DATE="${arg#--date=}" ;;
  esac
done
if [ -z "$RUN_DATE" ]; then
  RUN_DATE="$(node -e '
const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
const get = (type) => Number(parts.find((part) => part.type === type).value);
const target = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
target.setUTCDate(target.getUTCDate() - (get("hour") < 15 ? 2 : 1));
process.stdout.write(target.toISOString().slice(0, 10));
')"
fi

# Python có psycopg2 (Mac mini: /usr/bin/python3 không có, bản Homebrew mới có)
PYTHON=""
for cand in /opt/homebrew/bin/python3 /usr/local/bin/python3 python3 /usr/bin/python3; do
  if "$cand" -c "import psycopg2" >/dev/null 2>&1; then PYTHON="$cand"; break; fi
done
if [ -z "$PYTHON" ]; then
  echo "[Catch-up] ❌ Không tìm thấy python3 có psycopg2 → không kiểm tra được store thiếu."
  exit 1
fi

# Store thiếu đơn (orders) hoặc Ads của ngày RUN_DATE — đọc nhẹ theo store_id + date (có index)
MISSING="$(STORES_FILE="$SCRIPT_DIR/stores.json" RUN_DATE="$RUN_DATE" "$PYTHON" - <<'PY'
import json, os, sys
import psycopg2

stores = [
    s["store_name"].strip()
    for s in json.load(open(os.environ["STORES_FILE"]))
    if s.get("enabled", True) is not False and s.get("store_name") and s.get("profile_id")
]
conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("SET statement_timeout = 20000")
missing = []
for name in stores:
    cur.execute(
        """
        SELECT
          (SELECT count(*) FROM accounting_orders o WHERE o.store_id = s.id AND o.date = %s::date),
          (SELECT count(*) FROM accounting_ads a WHERE a.store_id = s.id AND a.date = %s::date)
        FROM stores s WHERE UPPER(s.name) = UPPER(%s) LIMIT 1
        """,
        (os.environ["RUN_DATE"], os.environ["RUN_DATE"], name),
    )
    row = cur.fetchone()
    orders, ads = (row or (0, 0))
    # File 02 đã được tải về (dù 0 đơn do Amazon không có phát sinh đơn)
    file02 = f"/Users/ad/AmazonAccounting/downloads/{os.environ['RUN_DATE']}/{name}/02_AllOrders_{os.environ['RUN_DATE']}.tsv"
    has_order_file = os.path.exists(file02) and os.path.getsize(file02) > 0
    if (not orders and not has_order_file) or not ads:
        missing.append(name)
        print(f"[Catch-up] {name}: đơn {orders} (có file={has_order_file}), Ads {ads} → chạy bù", file=sys.stderr)
conn.close()
print("\n".join(missing))
PY
)"

if [ -z "$MISSING" ]; then
  echo "[Catch-up] Ngày $RUN_DATE: đủ đơn + Ads cho mọi store. Không cần chạy bù."
  exit 0
fi

while IFS= read -r store; do
  [ -z "$store" ] && continue
  echo "[Catch-up] >>> Chạy bù $store ngày $RUN_DATE"
  bash "$SCRIPT_DIR/run_accounting_daily.sh" "--store=$store" "--date=$RUN_DATE" || echo "[Catch-up] ⚠️ $store chạy bù lỗi (xem log phía trên)."
done <<< "$MISSING"

echo "[Catch-up] $(date): xong."
