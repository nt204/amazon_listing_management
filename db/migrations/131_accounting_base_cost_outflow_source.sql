-- 131_accounting_base_cost_outflow_source.sql
-- Nguồn của sl_ra_kho (hàng ra kho trong tháng):
--   'ingest' = pipeline kế toán tháng tính từ file thô Amazon (scripts/ingest_monthly_from_raw.py) — ưu tiên cao nhất
--   'sheet'  = cột "Đã bán" của tab BASECOST THÁNG (file <STORE> INVENTORY) — đồng bộ sheet hằng ngày tự nạp
--             cho các tháng chưa có file thô, không bao giờ ghi đè số 'ingest'.

ALTER TABLE accounting_monthly_base_cost
  ADD COLUMN IF NOT EXISTS sl_ra_kho_source TEXT;

UPDATE accounting_monthly_base_cost
SET sl_ra_kho_source = CASE WHEN last_changed_by = 'monthly-ingest' THEN 'ingest' ELSE 'sheet' END
WHERE sl_ra_kho IS NOT NULL AND sl_ra_kho_source IS NULL;
