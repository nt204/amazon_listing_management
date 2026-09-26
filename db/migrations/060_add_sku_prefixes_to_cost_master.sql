-- 060_add_sku_prefixes_to_cost_master.sql
-- Thêm cột sku_prefixes vào product_cost_master để hỗ trợ lưu và tùy biến tiền tố SKU theo từng store

ALTER TABLE product_cost_master
  ADD COLUMN IF NOT EXISTS sku_prefixes TEXT[] NOT NULL DEFAULT '{}';

-- Backfill dữ liệu prefix chuẩn ban đầu cho các loại phôi hiện có (nếu chưa có prefix)
UPDATE product_cost_master
SET sku_prefixes = CASE
  WHEN product_type = 'Blanket Hoodie' THEN ARRAY['CBH']
  WHEN product_type = 'Oodie' THEN ARRAY['ODL', 'OHN', 'OC', 'OD']
  WHEN product_type = 'Blanket' THEN ARRAY['BDL', 'BQL', 'BKL', 'BHL', 'CB', 'BD']
  WHEN product_type = 'Garden Flag' THEN ARRAY['GFDL', 'GFQL', 'GF']
  WHEN product_type = 'Garden Flag Banner' THEN ARRAY['FL']
  WHEN product_type = 'Makeup Bag' THEN ARRAY['MBDL', 'MB']
  WHEN product_type = 'Glass Ornament' THEN ARRAY['GODL', 'GOQL', 'GOH', 'GOL', 'GO']
  WHEN product_type = 'Poster' THEN ARRAY['POL']
  WHEN product_type = 'Pillow' THEN ARRAY['PLL']
  WHEN product_type = 'Poncho' THEN ARRAY['PC']
  ELSE sku_prefixes
END
WHERE sku_prefixes = '{}';
