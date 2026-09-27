-- db/migrations/061_ppc_sale_kw_registry.sql
-- Quản trị các chiến dịch và từ khóa Sale KW đã lên (Lên Camp Sale KW)

CREATE TABLE IF NOT EXISTS ppc_sale_kw_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL DEFAULT '',
  source_campaign_id TEXT,
  source_campaign_name TEXT NOT NULL,
  target_campaign_name TEXT NOT NULL,
  ad_group_name TEXT NOT NULL DEFAULT '',
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',
  target_type TEXT NOT NULL DEFAULT 'KEYWORD',
  sku TEXT,
  bid NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
  daily_budget NUMERIC(10, 2) NOT NULL DEFAULT 10.00,
  orders INT NOT NULL DEFAULT 0,
  sales NUMERIC(10, 2) NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  spend NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cpc NUMERIC(10, 2) NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'enabled',
  source TEXT NOT NULL DEFAULT 'AUTO_UPLOAD',
  source_job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ppc_sale_kw_registry UNIQUE (store_id, target_campaign_name, keyword_text, match_type)
);

CREATE INDEX IF NOT EXISTS idx_ppc_sale_kw_registry_lookup 
  ON ppc_sale_kw_registry (store_id, LOWER(target_campaign_name), LOWER(keyword_text));

CREATE INDEX IF NOT EXISTS idx_ppc_sale_kw_registry_source_camp
  ON ppc_sale_kw_registry (store_id, LOWER(source_campaign_name));

CREATE INDEX IF NOT EXISTS idx_ppc_sale_kw_registry_store 
  ON ppc_sale_kw_registry (store_id, created_at DESC);
