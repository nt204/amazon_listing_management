#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

bash "$SCRIPT_DIR/maintenance.sh"

if [ ! -f "$SCRIPT_DIR/config.env" ]; then
  echo "[SCHEDULER] Thiếu config.env." >&2
  exit 1
fi
set -a
source "$SCRIPT_DIR/config.env"
set +a

if [ -z "${WEB_APP_URL:-}" ] || [ -z "${WEB_APP_AUTH_TOKEN:-}" ]; then
  echo "[SCHEDULER] Thiếu WEB_APP_URL hoặc WEB_APP_AUTH_TOKEN." >&2
  exit 1
fi

WEB_APP_URL="${WEB_APP_URL%/}"
ENDPOINT="$WEB_APP_URL/api/ppc/crawler/job"
MAX_ATTEMPTS="${SCHEDULE_ENQUEUE_MAX_ATTEMPTS:-24}"
WAIT_SECONDS="${SCHEDULE_ENQUEUE_RETRY_SECONDS:-300}"
STORES_FILE="$SCRIPT_DIR/stores.json"
if [ ! -f "$STORES_FILE" ]; then
  echo "[SCHEDULER] Thiếu stores.json." >&2
  exit 1
fi
SCHEDULE_PAYLOAD="$(STORES_FILE="$STORES_FILE" python3 -c '
import json, os
stores=json.load(open(os.environ["STORES_FILE"]))
names=[str(s.get("store_name","")).strip() for s in stores if s.get("enabled",True) is not False and s.get("store_name") and s.get("profile_id")]
if not names: raise SystemExit("stores.json không có store hợp lệ")
print(json.dumps({"storeName":"ALL", "storeNames":names}, separators=(",",":")))
')"

echo "============================================================"
echo "[SCHEDULER] $(date): gửi job ALL lên server; worker sẽ là tiến trình duy nhất crawl."
echo "============================================================"

for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
  RESPONSE_FILE="$(mktemp -t ppc-schedule-response.XXXXXX)"
  HTTP_STATUS="$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' \
    --connect-timeout 10 --max-time 30 \
    -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $WEB_APP_AUTH_TOKEN" \
    -H "Origin: $WEB_APP_URL" \
    -H 'Content-Type: application/json' \
    --data-binary "$SCHEDULE_PAYLOAD" || echo 000)"
  RESPONSE="$(<"$RESPONSE_FILE")"
  rm -f "$RESPONSE_FILE"

  if [ "$HTTP_STATUS" -ge 200 ] 2>/dev/null && [ "$HTTP_STATUS" -lt 300 ]; then
    echo "[SCHEDULER] ✅ Đã tạo job ALL thành công: $RESPONSE"
    exit 0
  fi

  if [ "$HTTP_STATUS" = "409" ]; then
    ACTIVE_STORE="$(RESPONSE_JSON="$RESPONSE" python3 -c 'import json,os; d=json.loads(os.environ.get("RESPONSE_JSON","{}")); print((d.get("activeJob") or {}).get("store_name", ""))' 2>/dev/null || true)"
    if [ "$ACTIVE_STORE" = "ALL" ]; then
      echo "[SCHEDULER] ✅ Đã có job ALL active; không tạo trùng."
      exit 0
    fi
    echo "[SCHEDULER] Có job ${ACTIVE_STORE:-khác} đang chạy; chờ ${WAIT_SECONDS}s (${attempt}/${MAX_ATTEMPTS})."
  else
    echo "[SCHEDULER] Server trả HTTP $HTTP_STATUS: ${RESPONSE:0:500}; retry ${attempt}/${MAX_ATTEMPTS}." >&2
  fi

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    sleep "$WAIT_SECONDS"
  fi
done

echo "[SCHEDULER] ❌ Không enqueue được job ALL sau $MAX_ATTEMPTS lần." >&2
exit 1
