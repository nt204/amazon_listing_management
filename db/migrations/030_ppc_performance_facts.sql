ALTER TABLE ppc_search_terms
  ADD COLUMN IF NOT EXISTS ad_type TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE ppc_search_terms
  DROP CONSTRAINT IF EXISTS ppc_search_terms_ad_type_check;

ALTER TABLE ppc_search_terms
  ADD CONSTRAINT ppc_search_terms_ad_type_check
  CHECK (ad_type IN ('SP', 'SB', 'SD', 'UNKNOWN'));

ALTER TABLE ppc_search_terms
  DROP CONSTRAINT IF EXISTS ppc_search_term_identity_unique;

DROP INDEX IF EXISTS ppc_search_term_identity_unique;

CREATE UNIQUE INDEX IF NOT EXISTS ppc_search_term_identity_unique_v2
  ON ppc_search_terms (
    store_id, ad_type, report_start_date, report_end_date, portfolio_name,
    campaign_name, ad_group_name, target_keyword, customer_search_term, match_type
  );

CREATE TABLE IF NOT EXISTS ppc_performance_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  report_start_date DATE NOT NULL,
  report_end_date DATE NOT NULL,
  report_granularity TEXT NOT NULL DEFAULT 'RANGE' CHECK (report_granularity IN ('DAILY', 'RANGE')),
  ad_type TEXT NOT NULL CHECK (ad_type IN ('SP', 'SB', 'SD', 'UNKNOWN')),
  grain TEXT NOT NULL CHECK (grain IN ('CAMPAIGN', 'AD_GROUP', 'TARGET', 'PRODUCT', 'PLACEMENT')),
  identity_key TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  ad_group_id TEXT NOT NULL DEFAULT '',
  ad_group_name TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  target_expression TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT 'Unknown',
  portfolio_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  asin TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  campaign_state TEXT NOT NULL DEFAULT '',
  ad_group_state TEXT NOT NULL DEFAULT '',
  targeting_type TEXT NOT NULL DEFAULT '',
  bidding_strategy TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL DEFAULT '',
  daily_budget NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (daily_budget >= 0),
  bid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (bid >= 0),
  placement_adjustment NUMERIC(12, 2) NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  spend NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  sales NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (sales >= 0),
  orders BIGINT NOT NULL DEFAULT 0 CHECK (orders >= 0),
  units BIGINT NOT NULL DEFAULT 0 CHECK (units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_performance_coverage_check CHECK (report_start_date <= report_end_date),
  CONSTRAINT ppc_performance_identity_unique UNIQUE (
    store_id, snapshot_date, report_start_date, report_end_date, ad_type, grain, identity_key
  )
);

CREATE INDEX IF NOT EXISTS ppc_performance_scope_idx
  ON ppc_performance_facts(store_id, report_start_date, report_end_date, ad_type, grain);

CREATE INDEX IF NOT EXISTS ppc_performance_campaign_idx
  ON ppc_performance_facts(store_id, campaign_id, grain);

CREATE INDEX IF NOT EXISTS ppc_performance_target_idx
  ON ppc_performance_facts(store_id, target_id, grain);
