-- 133_accounting_sku_monthly_recalc_queue.sql
-- SKU Monthly (accounting_sku_monthly / accounting_monthly_store_summary) tính lại từ file thô Amazon trên R2.
-- Hàng đợi ghi "store X cần tính lại kỳ Y": do worker Base Cost thêm vào sau khi tính lại giá vốn tháng
-- (lib/accounting/base-cost-resync.ts) hoặc do nút "Tính lại" trên trang SKU Monthly.
-- accounting-import-worker lấy việc ra, tải file thô từ R2 rồi chạy scripts/ingest_monthly_from_raw.py.

CREATE TABLE IF NOT EXISTS accounting_sku_monthly_recalc_queue (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (store_id, period)
);
