-- 044_map_cbh_to_blanket_hoodie.sql
-- Ánh xạ CBH* sang nhóm Blanket Hoodie thay vì Oodie.

-- 1. Bổ sung phôi Blanket Hoodie vào product_cost_master
INSERT INTO product_cost_master (
  product_type,
  base_cost,
  default_amazon_fee,
  tax_rate,
  default_price,
  break_even_acos,
  version,
  notes
)
VALUES
  ('Blanket Hoodie', 11.50, 15.70, 0.0300, 49.99, 46.00, 1, 'Profit Before Ads = 22.79; SKU: CBH* (Blanket Hoodie)')
ON CONFLICT (product_type, version) DO UPDATE
SET base_cost = EXCLUDED.base_cost,
    default_amazon_fee = EXCLUDED.default_amazon_fee,
    tax_rate = EXCLUDED.tax_rate,
    default_price = EXCLUDED.default_price,
    break_even_acos = EXCLUDED.break_even_acos,
    notes = EXCLUDED.notes,
    updated_at = NOW();

-- 2. Cập nhật rule sku_to_product_type_mapping: gỡ alias taxonomy và chuyển CBH sang Blanket Hoodie
UPDATE ppc_sku_mapping_rules
SET config_json = jsonb_set(
      config_json #- '{taxonomy,Blanket Hoodie}',
      '{prefix_rules}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'prefix' = 'CBH'
              THEN jsonb_set(item, '{product_type}', '"Blanket Hoodie"'::jsonb)
            ELSE item
          END
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(config_json->'prefix_rules') WITH ORDINALITY AS rules(item, ordinal)
      )
    ),
    version = '1.3',
    updated_at = NOW()
WHERE rule_set_id = 'sku_to_product_type_mapping';

-- 3. Cập nhật các bản ghi SKU hiện có thuộc tiền tố CBH
UPDATE sku_economics
SET product_type = 'Blanket Hoodie'
WHERE sku LIKE 'CBH%' OR sku LIKE 'cbh%';
