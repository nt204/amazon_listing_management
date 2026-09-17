-- 041_add_product_cost_masters_and_sku_prefixes.sql
-- Bổ sung phôi và sửa FL* sang Garden Flag Banner.

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
  ('Garden Flag',        1.40, 4.00, 0.0300, 16.99, 68.22, 1, 'Profit Before Ads = 11.59; SKU: GFDL*, GFQL*, GF*'),
  ('Garden Flag Banner', 1.40, 4.00, 0.0300, 12.99, 58.43, 1, 'Profit Before Ads = 7.59; SKU: FL*'),
  ('Poster',             2.00, 4.00, 0.0300, 16.99, 64.68, 1, 'Profit Before Ads = 10.99; SKU: POL*'),
  ('Makeup Bag',         1.50, 4.00, 0.0300,  9.99, 44.94, 1, 'Profit Before Ads = 4.49; SKU: MBDL*, MB*'),
  ('Pillow',             1.80, 4.00, 0.0300, 16.99, 65.86, 1, 'Profit Before Ads = 11.19; SKU: PLL*'),
  ('Glass Ornament',     1.80, 4.00, 0.0300, 16.99, 65.86, 1, 'Profit Before Ads = 11.19; SKU: GODL*, GOQL*, GOH*, GOL*, GO*')
ON CONFLICT (product_type, version) DO UPDATE
SET base_cost = EXCLUDED.base_cost,
    default_amazon_fee = EXCLUDED.default_amazon_fee,
    tax_rate = EXCLUDED.tax_rate,
    default_price = EXCLUDED.default_price,
    break_even_acos = EXCLUDED.break_even_acos,
    notes = EXCLUDED.notes,
    updated_at = NOW();

UPDATE ppc_sku_mapping_rules
SET config_json = jsonb_set(
      config_json,
      '{prefix_rules}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'prefix' = 'FL'
              THEN jsonb_set(item, '{product_type}', '"Garden Flag Banner"'::jsonb)
            ELSE item
          END
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(config_json->'prefix_rules') WITH ORDINALITY AS rules(item, ordinal)
      )
    ),
    version = '1.1',
    updated_at = NOW()
WHERE rule_set_id = 'sku_to_product_type_mapping';
