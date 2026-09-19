-- Migration 045: Precomputed daily summary table for instant trend analytics and daily slicing

CREATE TABLE IF NOT EXISTS ppc_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('SP', 'SB', 'SD', 'UNKNOWN', 'ALL')),
  impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  spend NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  sales NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (sales >= 0),
  orders BIGINT NOT NULL DEFAULT 0 CHECK (orders >= 0),
  units BIGINT NOT NULL DEFAULT 0 CHECK (units >= 0),
  cpc NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ctr NUMERIC(12, 4) NOT NULL DEFAULT 0,
  cvr NUMERIC(12, 4) NOT NULL DEFAULT 0,
  acos NUMERIC(12, 2) NOT NULL DEFAULT 0,
  roas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_daily_summary_unique UNIQUE (store_id, report_date, ad_type)
);

CREATE INDEX IF NOT EXISTS ppc_daily_summary_lookup_idx
  ON ppc_daily_summary(store_id, report_date DESC, ad_type);
