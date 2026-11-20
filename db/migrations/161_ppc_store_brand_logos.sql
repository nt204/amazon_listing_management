-- Logo SB theo store (mỗi store 1 logo), cùng bảng với Brand Entity ID.
ALTER TABLE ppc_store_brand_entities ALTER COLUMN brand_entity_id DROP NOT NULL;
ALTER TABLE ppc_store_brand_entities ADD COLUMN IF NOT EXISTS brand_logo_asset_id TEXT
  CHECK (brand_logo_asset_id IS NULL OR brand_logo_asset_id ~* '^amzn1\.assetlibrary\.asset1\.[a-z0-9]+(:version_v[0-9]+)?$');

-- Giá trị người dùng xác nhận ngày 2026-11-20
INSERT INTO ppc_store_brand_entities (store_name, brand_entity_id, updated_by) VALUES
  ('EKASPEEK', 'ENTITY37JWZ3Z23QBY4', 'seed')
ON CONFLICT (store_name) DO UPDATE SET brand_entity_id = EXCLUDED.brand_entity_id, updated_by = 'seed', updated_at = NOW();

INSERT INTO ppc_store_brand_entities (store_name, brand_logo_asset_id, updated_by) VALUES
  ('BOZSPACER', 'amzn1.assetlibrary.asset1.657ee77d77b33dd0738ac70b1aadc1e2:version_v1', 'seed'),
  ('WARMSTOREY', 'amzn1.assetlibrary.asset1.63d366fc75f62be85aef47a1e712acce:version_v1', 'seed'),
  ('EVERPHANT', 'amzn1.assetlibrary.asset1.a4c117a9cac3bb684813e41c882624ce:version_v1', 'seed')
ON CONFLICT (store_name) DO UPDATE SET brand_logo_asset_id = EXCLUDED.brand_logo_asset_id, updated_by = 'seed', updated_at = NOW();
