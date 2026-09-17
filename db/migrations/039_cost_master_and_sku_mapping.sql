-- 039_cost_master_and_sku_mapping.sql
-- Nâng cấp Quản lý Phôi (Cost Master) & Quy tắc ánh xạ SKU sang Loại sản phẩm

-- 1. Bổ sung cột default_price và break_even_acos vào bảng product_cost_master
ALTER TABLE product_cost_master
  ADD COLUMN IF NOT EXISTS default_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS break_even_acos NUMERIC(5, 2) NOT NULL DEFAULT 0;

-- 2. Tạo bảng lưu trữ cấu hình quy tắc ánh xạ SKU sang loại sản phẩm (Product Type)
CREATE TABLE IF NOT EXISTS ppc_sku_mapping_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id TEXT NOT NULL UNIQUE,
  config_json JSONB NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Lưu trữ bộ quy tắc JSON cấu hình chuẩn
INSERT INTO ppc_sku_mapping_rules (rule_set_id, config_json, version)
VALUES ('sku_to_product_type_mapping', '{
  "schema_version": "1.0",
  "rule_set_id": "sku_to_product_type_mapping",
  "normalization": {
    "trim_whitespace": true,
    "uppercase": true
  },
  "taxonomy": {
    "Blanket Hoodie": "Oodie"
  },
  "exception_map": {
    "BHL180660A01": "Glass Ornament"
  },
  "prefix_rules": [
    { "prefix": "CBH", "product_type": "Oodie" },
    { "prefix": "ODL", "product_type": "Oodie" },
    { "prefix": "OHN", "product_type": "Oodie" },
    { "prefix": "OC", "product_type": "Oodie" },
    { "prefix": "OD", "product_type": "Oodie" },

    { "prefix": "BDL", "product_type": "Blanket" },
    { "prefix": "BQL", "product_type": "Blanket" },
    { "prefix": "BKL", "product_type": "Blanket" },
    { "prefix": "BHL", "product_type": "Blanket" },
    { "prefix": "CB", "product_type": "Blanket" },
    { "prefix": "BD", "product_type": "Blanket" },

    { "prefix": "GFDL", "product_type": "Garden Flag" },
    { "prefix": "GFQL", "product_type": "Garden Flag" },
    { "prefix": "GF", "product_type": "Garden Flag" },
    { "prefix": "FL", "product_type": "Garden Flag" },

    { "prefix": "MBDL", "product_type": "Makeup Bag" },
    { "prefix": "MB", "product_type": "Makeup Bag" },

    { "prefix": "GODL", "product_type": "Glass Ornament" },
    { "prefix": "GOQL", "product_type": "Glass Ornament" },
    { "prefix": "GOH", "product_type": "Glass Ornament" },
    { "prefix": "GOL", "product_type": "Glass Ornament" },
    { "prefix": "GO", "product_type": "Glass Ornament" },

    { "prefix": "POL", "product_type": "Poster" },
    { "prefix": "PLL", "product_type": "Pillow" },
    { "prefix": "PC", "product_type": "Poncho" }
  ],
  "matching_strategy": {
    "priority": [
      "exception_map",
      "longest_prefix_match"
    ],
    "fallback": "UNKNOWN"
  }
}'::jsonb, '1.0')
ON CONFLICT (rule_set_id) DO UPDATE
SET config_json = EXCLUDED.config_json,
    updated_at = NOW();

-- 4. Cập nhật & Thêm mới bảng Phôi (Cost Master)
-- Các phôi có trong tài liệu với ACoS hòa cụ thể
-- Trung bình của 6 phôi chuẩn: (50 + 46 + 42 + 41 + 46 + 48) / 6 = 45.5%
INSERT INTO product_cost_master (product_type, base_cost, default_amazon_fee, tax_rate, default_price, break_even_acos, version, notes)
VALUES
  ('Tumbler 20Oz', 4.20, 8.40, 0.0300, 25.00, 50.00, 1, 'PPC-14 ghi Profit Before Ads = 12.40'),
  ('Bullet Tumbler', 5.00, 8.50, 0.0300, 25.00, 46.00, 1, 'PPC-14 ghi Profit Before Ads = 11.50'),
  ('Blanket', 7.00, 11.50, 0.0300, 32.00, 42.00, 1, 'PPC-14 ghi Profit Before Ads = 13.50'),
  ('Hoodie', 10.00, 15.50, 0.0300, 43.00, 41.00, 1, 'PPC-14 ghi Profit Before Ads = 17.50'),
  ('Oodie', 11.50, 15.70, 0.0300, 49.99, 46.00, 1, 'PPC-14 ghi Profit Before Ads = 22.79'),
  ('Ornament', 2.00, 6.32, 0.0300, 15.99, 48.00, 1, 'PPC-14 ghi Profit Before Ads = 7.67'),
  ('Glass Ornament', 2.00, 6.32, 0.0300, 15.99, 48.00, 1, 'PPC-14 ghi Profit Before Ads = 7.67 (Glass Ornament)'),
  ('Garden Flag', 0.00, 0.00, 0.0300, 0.00, 45.50, 1, 'Tự động tạo từ prefix rules, ACoS hòa trung bình (45.5%)'),
  ('Makeup Bag', 0.00, 0.00, 0.0300, 0.00, 45.50, 1, 'Tự động tạo từ prefix rules, ACoS hòa trung bình (45.5%)'),
  ('Poster', 0.00, 0.00, 0.0300, 0.00, 45.50, 1, 'Tự động tạo từ prefix rules, ACoS hòa trung bình (45.5%)'),
  ('Pillow', 0.00, 0.00, 0.0300, 0.00, 45.50, 1, 'Tự động tạo từ prefix rules, ACoS hòa trung bình (45.5%)'),
  ('Poncho', 0.00, 0.00, 0.0300, 0.00, 45.50, 1, 'Tự động tạo từ prefix rules, ACoS hòa trung bình (45.5%)')
ON CONFLICT (product_type, version) DO UPDATE
SET base_cost = EXCLUDED.base_cost,
    default_amazon_fee = EXCLUDED.default_amazon_fee,
    tax_rate = EXCLUDED.tax_rate,
    default_price = EXCLUDED.default_price,
    break_even_acos = EXCLUDED.break_even_acos,
    notes = EXCLUDED.notes,
    updated_at = NOW();
