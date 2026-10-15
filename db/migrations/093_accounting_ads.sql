-- db/migrations/093_accounting_ads.sql
-- Table to store Amazon Ads (Portfolios) daily reports and historical data from sheet ADS

CREATE TABLE IF NOT EXISTS accounting_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  portfolio TEXT NOT NULL,
  status TEXT DEFAULT '',
  budget_type TEXT DEFAULT '',
  budget NUMERIC DEFAULT 0,
  budget_start TEXT DEFAULT '',
  budget_end TEXT DEFAULT '',
  campaign_count INTEGER DEFAULT 0,
  impressions NUMERIC DEFAULT 0,
  clicks NUMERIC DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  spend NUMERIC DEFAULT 0,
  cpc NUMERIC DEFAULT 0,
  orders NUMERIC DEFAULT 0,
  sales NUMERIC DEFAULT 0,
  acos NUMERIC DEFAULT 0,
  roas NUMERIC DEFAULT 0,
  ntb_orders NUMERIC DEFAULT 0,
  pct_orders_ntb NUMERIC DEFAULT 0,
  ntb_sales NUMERIC DEFAULT 0,
  pct_sales_ntb NUMERIC DEFAULT 0,
  viewable_impressions NUMERIC DEFAULT 0,
  vcpm NUMERIC DEFAULT 0,
  sku TEXT DEFAULT '',
  loai TEXT DEFAULT 'FBA',
  mkt_pic TEXT DEFAULT '',
  tuan INTEGER DEFAULT 0,
  thang INTEGER DEFAULT 0,
  quy INTEGER DEFAULT 0,
  thue_10 NUMERIC DEFAULT 0,
  trang_thai TEXT DEFAULT '',
  custom_fields JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_ads_store_date_portfolio UNIQUE (store_id, date, portfolio)
);

CREATE INDEX IF NOT EXISTS idx_accounting_ads_store_date ON accounting_ads (store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_ads_store_sku ON accounting_ads (store_id, sku);
CREATE INDEX IF NOT EXISTS idx_accounting_ads_store_pic ON accounting_ads (store_id, mkt_pic);
CREATE INDEX IF NOT EXISTS idx_accounting_ads_date ON accounting_ads (date DESC);
