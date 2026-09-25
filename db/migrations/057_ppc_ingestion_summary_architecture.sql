-- Migration 057: Precomputed summary architecture for PPC Ingestion
-- Ingest computes summary tables atomically; dashboard reads only small summary rows.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Active Snapshots: Tracks the currently active snapshot per store and coverage days
CREATE TABLE IF NOT EXISTS ppc_active_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  coverage_days INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  report_start_date DATE NOT NULL,
  report_end_date DATE NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_active_snapshots_store_coverage_unique UNIQUE (store_id, coverage_days)
);

CREATE INDEX IF NOT EXISTS idx_ppc_active_snapshots_lookup
  ON ppc_active_snapshots(store_id, coverage_days);

-- 2. Snapshot Summary: Stores KPI totals, target counts, and store-level metrics
CREATE TABLE IF NOT EXISTS ppc_snapshot_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  coverage_days INTEGER NOT NULL,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('SP', 'SB', 'SD', 'ALL', 'UNKNOWN')),
  report_start_date DATE NOT NULL,
  report_end_date DATE NOT NULL,
  campaign_count INTEGER NOT NULL DEFAULT 0,
  active_campaign_count INTEGER NOT NULL DEFAULT 0,
  target_count INTEGER NOT NULL DEFAULT 0,
  active_target_count INTEGER NOT NULL DEFAULT 0,
  sku_count INTEGER NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(16, 2) NOT NULL DEFAULT 0,
  sales NUMERIC(16, 2) NOT NULL DEFAULT 0,
  orders BIGINT NOT NULL DEFAULT 0,
  units BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_snapshot_summary_unique UNIQUE (store_id, snapshot_id, coverage_days, ad_type)
);

CREATE INDEX IF NOT EXISTS idx_ppc_snapshot_summary_lookup
  ON ppc_snapshot_summary(store_id, coverage_days, snapshot_id);

-- 3. Campaign Summary: Precomputed campaign-level metrics for fast table listing & ranking
CREATE TABLE IF NOT EXISTS ppc_campaign_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  coverage_days INTEGER NOT NULL,
  ad_type TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  campaign_state TEXT,
  portfolio_name TEXT,
  daily_budget NUMERIC(12, 2) DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(16, 2) NOT NULL DEFAULT 0,
  sales NUMERIC(16, 2) NOT NULL DEFAULT 0,
  orders BIGINT NOT NULL DEFAULT 0,
  units BIGINT NOT NULL DEFAULT 0,
  target_count INTEGER NOT NULL DEFAULT 0,
  active_target_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_campaign_summary_unique UNIQUE (store_id, snapshot_id, coverage_days, ad_type, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_ppc_camp_summary_spend
  ON ppc_campaign_summary(store_id, coverage_days, snapshot_id, spend DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_camp_summary_orders
  ON ppc_campaign_summary(store_id, coverage_days, snapshot_id, orders DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_camp_summary_state
  ON ppc_campaign_summary(store_id, coverage_days, snapshot_id, campaign_state);

CREATE INDEX IF NOT EXISTS idx_ppc_camp_summary_adtype
  ON ppc_campaign_summary(store_id, coverage_days, snapshot_id, ad_type);

CREATE INDEX IF NOT EXISTS idx_ppc_camp_summary_name_trgm
  ON ppc_campaign_summary USING gin (lower(campaign_name) gin_trgm_ops);

-- 4. SKU Summary: Precomputed SKU-level metrics
CREATE TABLE IF NOT EXISTS ppc_sku_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  coverage_days INTEGER NOT NULL,
  ad_type TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_type TEXT,
  campaign_count INTEGER NOT NULL DEFAULT 0,
  target_count INTEGER NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(16, 2) NOT NULL DEFAULT 0,
  sales NUMERIC(16, 2) NOT NULL DEFAULT 0,
  orders BIGINT NOT NULL DEFAULT 0,
  units BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_sku_summary_unique UNIQUE (store_id, snapshot_id, coverage_days, ad_type, sku)
);

CREATE INDEX IF NOT EXISTS idx_ppc_sku_summary_lookup
  ON ppc_sku_summary(store_id, coverage_days, snapshot_id, lower(sku));

CREATE INDEX IF NOT EXISTS idx_ppc_sku_summary_spend
  ON ppc_sku_summary(store_id, coverage_days, snapshot_id, spend DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_sku_summary_orders
  ON ppc_sku_summary(store_id, coverage_days, snapshot_id, orders DESC);

-- 5. Target Breakdown Summary: Precomputed keyword/targeting type distribution
CREATE TABLE IF NOT EXISTS ppc_target_breakdown_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  coverage_days INTEGER NOT NULL,
  ad_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  keyword_match_type TEXT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(16, 2) NOT NULL DEFAULT 0,
  sales NUMERIC(16, 2) NOT NULL DEFAULT 0,
  orders BIGINT NOT NULL DEFAULT 0,
  units BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_target_breakdown_summary_unique UNIQUE (store_id, snapshot_id, coverage_days, ad_type, target_type, keyword_match_type)
);

CREATE INDEX IF NOT EXISTS idx_ppc_target_breakdown_lookup
  ON ppc_target_breakdown_summary(store_id, coverage_days, snapshot_id);
