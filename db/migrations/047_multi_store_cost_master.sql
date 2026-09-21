-- 047_multi_store_cost_master.sql
-- Gắn store_id vào product_cost_master để hỗ trợ quản lý phôi theo từng shop

ALTER TABLE product_cost_master
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES ppc_stores(id) ON DELETE CASCADE;

-- Gán các phôi hiện tại cho store HSOSTORE
UPDATE product_cost_master
SET store_id = (SELECT id FROM ppc_stores WHERE name = 'HSOSTORE' LIMIT 1)
WHERE store_id IS NULL;

-- Cập nhật unique constraint để mỗi store có version riêng của từng loại phôi
ALTER TABLE product_cost_master
  DROP CONSTRAINT IF EXISTS product_cost_master_version_unique;

ALTER TABLE product_cost_master
  DROP CONSTRAINT IF EXISTS product_cost_master_store_version_unique;

ALTER TABLE product_cost_master
  ADD CONSTRAINT product_cost_master_store_version_unique UNIQUE (store_id, product_type, version);

CREATE INDEX IF NOT EXISTS idx_product_cost_master_store_lookup 
  ON product_cost_master (store_id, product_type, version DESC);
