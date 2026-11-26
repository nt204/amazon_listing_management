#!/usr/bin/env bash
# Chép script kế toán tháng sang Mac mini — máy chạy crawler + ingest hằng tháng (mac-crawler/monthly_crawler.ts gọi
# <MAC_MINI_DIR>/scripts/ingest_monthly_from_raw.py). Mac mini giữ bản chép riêng, không tự lấy code từ git:
# quên chép thì crawler tháng sau chạy code cũ (2026-11-02: mất phí lưu kho, thiếu hàng ra kho, sai removal).
#
# Dùng: bash scripts/sync-mac-mini.sh
set -euo pipefail

MAC_MINI="${MAC_MINI:-ad@100.111.217.54}"
DEST="${MAC_MINI_DIR:-/Users/ad/mac-crawler}"
# Pair mapping: local_file:remote_relative_path
ITEMS=(
  "scripts/ingest_monthly_from_raw.py:scripts/ingest_monthly_from_raw.py"
  # SKU FBM-monthly: ingest_monthly_from_raw.py import các module này
  "scripts/fbm_monthly_engine.py:scripts/fbm_monthly_engine.py"
  "scripts/fbm_monthly_raw.py:scripts/fbm_monthly_raw.py"
  "scripts/fbm_monthly_db.py:scripts/fbm_monthly_db.py"
  "mac-crawler/monthly_crawler.ts:monthly_crawler.ts"
  "mac-crawler/run_accounting_monthly.sh:run_accounting_monthly.sh"
  # Crawler kế toán ngày 16h10 (gồm tải kèm tồn FBA/AWD real time)
  "mac-crawler/accounting_crawler.ts:accounting_crawler.ts"
  # Tồn FBA (Inventory Ledger): thứ 2 hằng tuần + ngày 4 chốt cuối tháng; file rỗng/sai ngày thì thử lại, không nạp
  "mac-crawler/inventory_crawler.ts:inventory_crawler.ts"
  # Cuối pipeline kế toán ngày: gọi /api/accounting/financials/report-daily/after-crawl gửi Báo cáo KPI ngày
  "mac-crawler/run_accounting_daily.sh:run_accounting_daily.sh"
  # Crawler lệch kho (thứ 2, 2h): phân loại lô + tính chi tiết theo SKU cho lô 1 SKU
  "mac-crawler/get_discrepancy_shipments.py:get_discrepancy_shipments.py"
  "mac-crawler/shipment_discrepancy_crawler.ts:shipment_discrepancy_crawler.ts"
  "mac-crawler/run_shipment_discrepancy_daily.sh:run_shipment_discrepancy_daily.sh"
  # Lịch chạy (đổi lịch phải nạp lại: bash install_shipment_discrepancy_service.sh trên Mac mini)
  "mac-crawler/com.amazon.shipment.discrepancy.plist:com.amazon.shipment.discrepancy.plist"
  "mac-crawler/install_shipment_discrepancy_service.sh:install_shipment_discrepancy_service.sh"
)

cd "$(dirname "$0")/.."
for ITEM in "${ITEMS[@]}"; do
  LOCAL="${ITEM%%:*}"
  REMOTE="${ITEM##*:}"
  ssh -o StrictHostKeyChecking=accept-new "$MAC_MINI" \
    "mkdir -p '$DEST/$(dirname "$REMOTE")' && cp '$DEST/$REMOTE' '$DEST/$REMOTE.bak-$(date +%Y%m%d-%H%M%S)' 2>/dev/null || true"
  scp "$LOCAL" "$MAC_MINI:$DEST/$REMOTE"
  ssh "$MAC_MINI" "cmp -s /dev/stdin '$DEST/$REMOTE'" < "$LOCAL"
  echo "✅ Mac mini đã có $REMOTE (từ $LOCAL) bản $(git log -1 --format=%h -- "$LOCAL" 2>/dev/null || echo 'mới nhất')"
done
