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

AUTH_HEADER=""
if [ -n "$WEB_APP_AUTH_TOKEN" ]; then
  AUTH_HEADER="Authorization: Bearer $WEB_APP_AUTH_TOKEN"
fi

echo "[WEB APP SYNC] Đang gửi yêu cầu quét và nạp dữ liệu từ Cloudflare R2..."
HTTP_BODY_FILE="$(mktemp -t ppc-sync-response.XXXXXX)"
trap 'rm -f "$HTTP_BODY_FILE"' EXIT
HTTP_STATUS=$(curl -sS -o "$HTTP_BODY_FILE" -w "%{http_code}" -X POST "$ENDPOINT" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -H "Content-Type: application/json" \
  -H "Origin: $WEB_APP_URL" \
  --max-time 600)
RESPONSE=$(<"$HTTP_BODY_FILE")

if [ "$HTTP_STATUS" -lt 200 ] || [ "$HTTP_STATUS" -ge 300 ]; then
  echo "[LỖI] Server trả HTTP $HTTP_STATUS: $RESPONSE" >&2
  exit 1
fi

if ! printf '%s' "$RESPONSE" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
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
