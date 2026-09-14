CREATE TABLE IF NOT EXISTS ppc_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',
  target_acos NUMERIC(5, 2) NOT NULL DEFAULT 30.0,
  daily_budget NUMERIC(10, 2) DEFAULT 500.0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_store_team_name_unique UNIQUE(team_id, name)
);

CREATE TABLE IF NOT EXISTS ppc_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 'SP',
  targeting_type TEXT NOT NULL DEFAULT 'MANUAL',
  daily_budget NUMERIC(10, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ENABLED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_campaign_store_unique UNIQUE(store_id, campaign_name)
);

CREATE TABLE IF NOT EXISTS ppc_search_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  portfolio_name TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL,
  ad_group_name TEXT NOT NULL DEFAULT '',
  target_keyword TEXT NOT NULL DEFAULT '',
  customer_search_term TEXT NOT NULL,
  match_type TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  spend NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  sales NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (sales >= 0),
  orders INTEGER NOT NULL DEFAULT 0 CHECK (orders >= 0),
  units INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  cpc NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cpc >= 0),
  ctr NUMERIC(10, 6) NOT NULL DEFAULT 0 CHECK (ctr >= 0),
  cvr NUMERIC(10, 6) NOT NULL DEFAULT 0 CHECK (cvr >= 0),
  acos NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (acos >= 0),
  roas NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (roas >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_search_term_identity_unique UNIQUE (
    store_id, report_date, portfolio_name, campaign_name, ad_group_name,
    target_keyword, customer_search_term, match_type
  )
);

CREATE TABLE IF NOT EXISTS ppc_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('BLEEDING_KEYWORD', 'HIGH_ACOS', 'OUT_OF_BUDGET', 'LOW_CVR')),
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'WARNING', 'INFO')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  sku TEXT,
  search_term TEXT,
  metric_value NUMERIC(12, 2),
  threshold_value NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED', 'DISMISSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ppc_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  rec_type TEXT NOT NULL CHECK (rec_type IN ('NEGATIVE_KEYWORD', 'BID_DECREASE', 'BID_INCREASE', 'HARVEST_KEYWORD')),
  target_type TEXT NOT NULL DEFAULT 'EXACT' CHECK (target_type IN ('EXACT', 'PHRASE', 'PRODUCT')),
  keyword TEXT NOT NULL,
  campaign_name TEXT,
  current_bid NUMERIC(12, 2),
  recommended_bid NUMERIC(12, 2),
  reason TEXT NOT NULL,
  estimated_savings NUMERIC(12, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'DISMISSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ppc_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('CLOUDFLARE_R2', 'MANUAL_UPLOAD', 'MOCK_DATA')),
  file_name TEXT,
  source_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED')),
  records_count INTEGER DEFAULT 0 CHECK (records_count >= 0),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppc_stores_team_idx ON ppc_stores(team_id, lower(name));
CREATE INDEX IF NOT EXISTS ppc_search_terms_store_date_idx ON ppc_search_terms(store_id, report_date DESC);
CREATE INDEX IF NOT EXISTS ppc_search_terms_portfolio_idx ON ppc_search_terms(store_id, portfolio_name);
CREATE INDEX IF NOT EXISTS ppc_search_terms_acos_idx ON ppc_search_terms(store_id, acos DESC);
CREATE INDEX IF NOT EXISTS ppc_alerts_store_status_idx ON ppc_alerts(store_id, status, severity);
CREATE INDEX IF NOT EXISTS ppc_recommendations_store_status_idx ON ppc_recommendations(store_id, status);
CREATE INDEX IF NOT EXISTS ppc_sync_logs_team_created_idx ON ppc_sync_logs(team_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ppc_sync_logs_source_file_version_idx
  ON ppc_sync_logs(team_id, source, file_name, source_version)
  WHERE file_name IS NOT NULL AND source_version IS NOT NULL AND status = 'SUCCESS';
