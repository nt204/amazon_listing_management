#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load biến môi trường từ config.env
if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

WEB_APP_URL="${WEB_APP_URL:-http://localhost:2411}"
ENDPOINT="${WEB_APP_URL}/api/ppc/sync-r2"

echo "============================================================"
echo "[WEB APP SYNC] KÍCH HOẠT HỆ THỐNG ĐỒNG BỘ DỮ LIỆU TỪ R2"
echo "URL: $ENDPOINT"
echo "Thời gian: $(date)"
echo "============================================================"

# Kiểm tra Web App có đang hoạt động không
if ! curl -s -f -o /dev/null --max-time 5 "$WEB_APP_URL"; then
  echo "[CẢNH BÁO] Không thể kết nối tới Web App tại $WEB_APP_URL."
  echo "Vui lòng đảm bảo Next.js server đang chạy (npm run dev hoặc qua PM2/Docker)."
  exit 1
fi

SYNC_TARGET_FILE="$HOME/Library/Application Support/AmazonPpcCrawler/last-sync-target.json"
SYNC_PAYLOAD="{}"
if [ -s "$SYNC_TARGET_FILE" ]; then
  SYNC_PAYLOAD="$(<"$SYNC_TARGET_FILE")"
  echo "[WEB APP SYNC] Chỉ đồng bộ các batch vừa publish trong $SYNC_TARGET_FILE"
else
  echo "[WEB APP SYNC] Không có target file; dùng chế độ quét tương thích."
fi

echo "[WEB APP SYNC] Đang gửi yêu cầu quét và nạp dữ liệu từ Cloudflare R2..."
HTTP_BODY_FILE="$(mktemp -t ppc-sync-response.XXXXXX)"
trap 'rm -f "$HTTP_BODY_FILE"' EXIT
CURL_ARGS=(-sS -o "$HTTP_BODY_FILE" -w "%{http_code}" -X POST "$ENDPOINT")
if [ -n "${WEB_APP_AUTH_TOKEN:-}" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer $WEB_APP_AUTH_TOKEN")
fi
CURL_ARGS+=(-H "Content-Type: application/json" -H "Origin: $WEB_APP_URL" --data-binary "$SYNC_PAYLOAD" --max-time 600)
HTTP_STATUS=$(curl "${CURL_ARGS[@]}")
RESPONSE=$(<"$HTTP_BODY_FILE")

if [ "$HTTP_STATUS" -lt 200 ] || [ "$HTTP_STATUS" -ge 300 ]; then
  echo "[LỖI] Server trả HTTP $HTTP_STATUS: $RESPONSE" >&2
  exit 1
fi

if ! RESPONSE_JSON="$RESPONSE" python3 -c 'import json, os, sys; d=json.loads(os.environ["RESPONSE_JSON"]); sys.exit(0 if d.get("success") is True and int((d.get("result") or {}).get("failed", 0)) == 0 else 1)' 2>/dev/null; then
  echo "[LỖI] Server không xác nhận sync thành công: $RESPONSE" >&2
  exit 1
fi

echo ""
echo "[KẾT QUẢ TỪ WEB APP]:"
echo "$RESPONSE"
echo ""
echo "============================================================"
echo "[WEB APP SYNC] HOÀN TẤT ĐỒNG BỘ CSDL POSTGRESQL!"
echo "============================================================"
