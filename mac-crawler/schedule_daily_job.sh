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
MAX_ATTEMPTS="${SCHEDULE_STORE_ENQUEUE_MAX_ATTEMPTS:-3}"
WAIT_SECONDS="${SCHEDULE_STORE_ENQUEUE_RETRY_SECONDS:-30}"
STORES_FILE="$SCRIPT_DIR/stores.json"
RUN_DATE="$(date +%Y-%m-%d)"

if [ ! -f "$STORES_FILE" ]; then
  echo "[SCHEDULER] Thiếu stores.json." >&2
  exit 1
fi

# One line per enabled store. Store names are validated again by the server and worker.
STORE_LIST_FILE="$(mktemp -t ppc-schedule-stores.XXXXXX)"
if ! STORES_FILE="$STORES_FILE" python3 -c '
import json, os
stores=json.load(open(os.environ["STORES_FILE"]))
names=[]
seen=set()
for store in stores:
    name=str(store.get("store_name", "")).strip()
    profile=str(store.get("profile_id", "")).strip()
    key=name.lower()
    if store.get("enabled", True) is not False and name and profile and key not in seen:
        seen.add(key)
        names.append(name)
if not names: raise SystemExit("stores.json không có store hợp lệ")
print("\n".join(names))
' > "$STORE_LIST_FILE"; then
  rm -f "$STORE_LIST_FILE"
  echo "[SCHEDULER] stores.json không hợp lệ." >&2
  exit 1
fi
STORE_NAMES=()
while IFS= read -r store_name; do
  [ -n "$store_name" ] && STORE_NAMES+=("$store_name")
done < "$STORE_LIST_FILE"
rm -f "$STORE_LIST_FILE"

IS_FORCE=false
for arg in "$@"; do
  if [ "$arg" = "--force" ] || [ "$arg" = "-f" ] || [ "$arg" = "--test" ]; then
    IS_FORCE=true
  fi
done

echo "============================================================"
if [ "$IS_FORCE" = "true" ]; then
  echo "[SCHEDULER] $(date): CHẾ ĐỘ FORCE TEST - xếp ${#STORE_NAMES[@]} job cho ngày $RUN_DATE."
else
  echo "[SCHEDULER] $(date): xếp ${#STORE_NAMES[@]} job riêng theo store cho ngày $RUN_DATE."
fi
echo "============================================================"

enqueued=0
skipped=0
failed=0

for store_name in "${STORE_NAMES[@]}"; do
  payload="$(STORE_NAME="$store_name" RUN_DATE="$RUN_DATE" IS_FORCE="$IS_FORCE" python3 -c '
import json, os, time
name = os.environ["STORE_NAME"]
date = os.environ["RUN_DATE"]
is_force = os.environ.get("IS_FORCE") == "true"
enqueue_key = f"daily:{date}:{name.lower()}:{int(time.time())}" if is_force else f"daily:{date}:{name.lower()}"
payload = {
    "storeName": name,
    "enqueueKey": enqueue_key
}
if is_force:
    payload["forceNew"] = True
print(json.dumps(payload, separators=(",", ":")))
')"

  submitted=false
  for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
    response_file="$(mktemp -t ppc-schedule-response.XXXXXX)"
    http_status="$(curl -sS -o "$response_file" -w '%{http_code}' \
      --connect-timeout 10 --max-time 30 \
      -X POST "$ENDPOINT" \
      -H "Authorization: Bearer $WEB_APP_AUTH_TOKEN" \
      -H "Origin: $WEB_APP_URL" \
      -H 'Content-Type: application/json' \
      --data-binary "$payload" || echo 000)"
    response="$(<"$response_file")"
    rm -f "$response_file"

    if [ "$http_status" -ge 200 ] 2>/dev/null && [ "$http_status" -lt 300 ]; then
      duplicate="$(RESPONSE_JSON="$response" python3 -c 'import json,os; print("yes" if json.loads(os.environ.get("RESPONSE_JSON", "{}")).get("duplicate") else "no")' 2>/dev/null || echo no)"
      if [ "$duplicate" = "yes" ]; then
        echo "[SCHEDULER] ↪ [$store_name] job hôm nay đã tồn tại."
        skipped=$((skipped + 1))
      else
        echo "[SCHEDULER] ✅ [$store_name] đã vào hàng đợi."
        enqueued=$((enqueued + 1))
      fi
      submitted=true
      break
    fi

    if [ "$http_status" = "409" ]; then
      echo "[SCHEDULER] ↪ [$store_name] đã có job active; bỏ qua để không tạo trùng."
      skipped=$((skipped + 1))
      submitted=true
      break
    fi

    echo "[SCHEDULER] [$store_name] HTTP $http_status: ${response:0:300} (lần $attempt/$MAX_ATTEMPTS)." >&2
    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then sleep "$WAIT_SECONDS"; fi
  done

  if [ "$submitted" != "true" ]; then
    failed=$((failed + 1))
    echo "[SCHEDULER] ❌ Không xếp được job [$store_name]." >&2
  fi
done

echo "[SCHEDULER] Hoàn tất: mới=$enqueued, đã có=$skipped, lỗi=$failed."
if [ "$failed" -gt 0 ]; then exit 1; fi
