-- Migration 070: Add SKU column to ppc_search_terms and create precomputed Sale Keywords summary table
-- Eliminates heavy regex scanning and on-the-fly groupings on every Sale KW dashboard request.

-- 1. Add sku column to ppc_search_terms
ALTER TABLE ppc_search_terms
  ADD COLUMN IF NOT EXISTS sku TEXT;

-- 2. Create optimized lookup indexes
CREATE INDEX IF NOT EXISTS idx_ppc_search_terms_store_sku
  ON ppc_search_terms (store_id, upper(sku));

CREATE INDEX IF NOT EXISTS idx_ppc_search_terms_store_date_sku
  ON ppc_search_terms (store_id, report_date DESC, upper(sku));

-- 3. Backfill sku for existing ppc_search_terms rows
UPDATE ppc_search_terms
SET sku = upper(COALESCE(
  NULLIF(trim(portfolio_name), ''),
  substring(campaign_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'),
  'UNKNOWN_SKU'
))
WHERE sku IS NULL;

-- 4. Create Precomputed Summary Table for Sale Keywords
CREATE TABLE IF NOT EXISTS ppc_sale_kw_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  customer_search_term TEXT NOT NULL,
  days_window INTEGER NOT NULL DEFAULT 30,
  source_campaign_id TEXT,
  source_campaign_name TEXT,
  source_campaign_names TEXT[] NOT NULL DEFAULT '{}',
  source_ad_group_id TEXT,
  source_ad_group_name TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ppc_sale_kw_summary
  ON ppc_sale_kw_summary (store_id, days_window, upper(sku), lower(customer_search_term));

CREATE INDEX IF NOT EXISTS idx_ppc_sale_kw_summary_lookup
  ON ppc_sale_kw_summary (store_id, days_window, orders DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_sale_kw_summary_sku
  ON ppc_sale_kw_summary (store_id, days_window, upper(sku));

-- 5. Index target_expression on ppc_performance_facts to eliminate sequential scans during target matching
CREATE INDEX IF NOT EXISTS idx_ppc_performance_target_expr
  ON ppc_performance_facts (store_id, lower(trim(target_expression)))
  WHERE grain = 'TARGET';
