CREATE TABLE IF NOT EXISTS ppc_negative_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL DEFAULT '',
  ad_type TEXT NOT NULL DEFAULT 'SP',
  campaign_id TEXT,
  campaign_name TEXT NOT NULL,
  ad_group_id TEXT,
  ad_group_name TEXT,
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'negativeExact',
  level TEXT NOT NULL DEFAULT 'AD_GROUP',
  state TEXT NOT NULL DEFAULT 'enabled',
  source TEXT NOT NULL DEFAULT 'AUTO_UPLOAD',
  source_job_id TEXT,
  clicks INT NOT NULL DEFAULT 0,
  spend NUMERIC(10, 2) NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ppc_negative_registry UNIQUE (store_id, campaign_name, keyword_text, match_type)
);

CREATE INDEX IF NOT EXISTS idx_ppc_neg_registry_lookup 
  ON ppc_negative_registry (store_id, LOWER(campaign_name), LOWER(keyword_text));

CREATE INDEX IF NOT EXISTS idx_ppc_neg_registry_store 
  ON ppc_negative_registry (store_id, created_at DESC);
