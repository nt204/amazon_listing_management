-- db/migrations/064_add_lookup_indexes_to_registries.sql
-- Tối ưu tốc độ tra cứu và deduplicate từ khóa trong Sale KW và Negative Registry

CREATE INDEX IF NOT EXISTS idx_ppc_sale_kw_reg_kw 
  ON ppc_sale_kw_registry (store_id, lower(trim(keyword_text)));

CREATE INDEX IF NOT EXISTS idx_ppc_neg_registry_kw 
  ON ppc_negative_registry (store_id, lower(trim(keyword_text)));
