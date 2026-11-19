-- Lên camp SKU mới: Brand Entity ID chuẩn theo store (mỗi tài khoản Amazon 1 Entity).
-- SKU thiếu / ghi sai Entity trong Bảng mã thì dùng giá trị ở đây. Sửa trên web: Lên camp SKU mới → Tùy chỉnh nâng cao.
CREATE TABLE IF NOT EXISTS ppc_store_brand_entities (
  store_name TEXT PRIMARY KEY, -- tên store viết hoa (khớp stores.name)
  brand_entity_id TEXT NOT NULL CHECK (brand_entity_id ~ '^ENTITY[A-Z0-9]{8,}$'),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Giá trị người dùng xác nhận ngày 2026-11-19
INSERT INTO ppc_store_brand_entities (store_name, brand_entity_id, updated_by) VALUES
  ('BOZSPACER', 'ENTITY3AT8FKLQW4N7D', 'seed'),
  ('WARMSTOREY', 'ENTITY3IYC3SH3PWY2N', 'seed'),
  ('FASTPEACE', 'ENTITYV2ATDCIA1RLK', 'seed'),
  ('LIMIMA', 'ENTITY12JEBB4JCC26O', 'seed'),
  ('MALFIRST', 'ENTITY2313JI85L1XLM', 'seed'),
  ('EVERPHANT', 'ENTITY365Y2S5L7L7N9', 'seed')
ON CONFLICT (store_name) DO NOTHING;
