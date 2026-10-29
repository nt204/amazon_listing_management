-- 121_fbm_sku_master_unique_sku_asin.sql
-- BẢNG MÃ FBM: cùng SKU nhưng khác ASIN là 2 sản phẩm khác nhau; chỉ trùng cả SKU + ASIN mới là trùng
-- (kế toán xác nhận 29/10/2026, vd AOTT1015TV15C có 2 ASIN B0FX9YWSF6 / B0HN7WZF8Q).
-- Bảng FBA (accounting_sku_master) giữ UNIQUE (store_id, sku).

ALTER TABLE accounting_sku_master_fbm
  DROP CONSTRAINT IF EXISTS accounting_sku_master_fbm_store_id_sku_key;
DROP INDEX IF EXISTS accounting_sku_master_fbm_store_id_sku_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_sku_master_fbm_store_sku_asin
  ON accounting_sku_master_fbm (store_id, sku, (COALESCE(asin, '')));
