-- 042_mark_unmapped_sku_as_prefix_error.sql
-- SKU không khớp exception/prefix phải được đánh dấu lỗi, không đoán loại phôi.

UPDATE ppc_sku_mapping_rules
SET config_json = jsonb_set(config_json, '{matching_strategy,fallback}', '"Lỗi Prefix"'::jsonb),
    version = '1.2',
    updated_at = NOW()
WHERE rule_set_id = 'sku_to_product_type_mapping';
