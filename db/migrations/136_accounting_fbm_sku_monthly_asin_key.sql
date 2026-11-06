-- Mỗi dòng SKU FBM-monthly = 1 sản phẩm SKU + ASIN: cùng SKU khác ASIN là 2 sản phẩm (asin '' khi bảng mã không có ASIN).
-- 135 đã chạy trên production (2026-11-06) với khoá (store_id, year, month, sku), nên đổi khoá ở migration riêng.
UPDATE accounting_fbm_sku_monthly SET asin = '' WHERE asin IS NULL;
ALTER TABLE accounting_fbm_sku_monthly ALTER COLUMN asin SET DEFAULT '';
ALTER TABLE accounting_fbm_sku_monthly ALTER COLUMN asin SET NOT NULL;
ALTER TABLE accounting_fbm_sku_monthly DROP CONSTRAINT IF EXISTS uq_accounting_fbm_sku_monthly;
ALTER TABLE accounting_fbm_sku_monthly ADD CONSTRAINT uq_accounting_fbm_sku_monthly UNIQUE (store_id, year, month, sku, asin);
