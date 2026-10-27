-- 115_sku_economics_cost_sources.sql
-- Ghi lại nguồn của Giá bán / Basecost / Phí Amazon cho từng SKU:
-- OVERRIDE (sửa tay) → COST_MASTER (khai báo phôi) → ACCOUNTING_* (dữ liệu kế toán) → DEFAULT.
ALTER TABLE sku_economics
  ADD COLUMN IF NOT EXISTS cost_sources JSONB NOT NULL DEFAULT '{}'::jsonb;
