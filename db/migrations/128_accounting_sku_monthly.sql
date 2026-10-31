-- Migration 128: Add accounting_sku_monthly and accounting_monthly_store_summary
-- For managing monthly SKU-level performance and store-level monthly summaries

CREATE TABLE IF NOT EXISTS accounting_sku_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  year INT NOT NULL DEFAULT 2026,
  month INT NOT NULL, -- 1..12
  sku TEXT NOT NULL,
  asin TEXT,
  product_type TEXT,
  mockup_url TEXT,
  fnsku TEXT,
  status TEXT,
  
  -- Core Financials (Exact to Excel SKU-monthly)
  revenue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 0,
  ads_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost NUMERIC(14, 4) NOT NULL DEFAULT 0,
  amazon_fee_unrecognized NUMERIC(14, 4) NOT NULL DEFAULT 0,
  amazon_fee_trans NUMERIC(14, 4) NOT NULL DEFAULT 0,
  thue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  return_amount NUMERIC(14, 4) NOT NULL DEFAULT 0,
  adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  storage_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  placement_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  long_term_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  fba_customer_return_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  liquidations NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost_return_adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  removal NUMERIC(14, 4) NOT NULL DEFAULT 0,
  profit NUMERIC(14, 4) NOT NULL DEFAULT 0,
  
  -- Unit & Ratios
  available_now INT NOT NULL DEFAULT 0,
  tacos NUMERIC(8, 4),
  acos NUMERIC(8, 4),
  margin NUMERIC(8, 4),
  roi NUMERIC(8, 4),
  profit_per_item NUMERIC(14, 4),
  basecost_per_item NUMERIC(14, 4),
  
  -- Extended columns
  vat_tax_adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  removal_qty_2024 INT NOT NULL DEFAULT 0,
  awd_subscription_fees NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost_adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  revenue_ads NUMERIC(14, 4) NOT NULL DEFAULT 0,
  listing_month TEXT,
  review_month TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT uq_accounting_sku_monthly UNIQUE (store_id, year, month, sku)
);

CREATE INDEX IF NOT EXISTS idx_accounting_sku_monthly_store_ym 
  ON accounting_sku_monthly (store_id, year, month);

CREATE INDEX IF NOT EXISTS idx_accounting_sku_monthly_sku 
  ON accounting_sku_monthly (sku);

CREATE TABLE IF NOT EXISTS accounting_monthly_store_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  year INT NOT NULL DEFAULT 2026,
  month INT NOT NULL,
  
  total_revenue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_quantity INT NOT NULL DEFAULT 0,
  total_ads_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_basecost NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_amazon_fee_unrecognized NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_amazon_fee_trans NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_thue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_return_amount NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_storage_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_placement_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_long_term_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_fba_customer_return_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_liquidations NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_basecost_return_adj NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_removal NUMERIC(14, 4) NOT NULL DEFAULT 0,
  
  -- Account-level adjustments
  vat_tax_adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  awd_subscription_fees NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost_adjustment NUMERIC(14, 4) NOT NULL DEFAULT 0,
  
  total_sku_profit NUMERIC(14, 4) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14, 4) NOT NULL DEFAULT 0, -- total_sku_profit + awd_subscription_fees
  total_available_now INT NOT NULL DEFAULT 0,
  total_revenue_ads NUMERIC(14, 4) NOT NULL DEFAULT 0,
  
  tacos NUMERIC(8, 4),
  acos NUMERIC(8, 4),
  margin NUMERIC(8, 4),
  roi NUMERIC(8, 4),
  
  active_sku_count INT NOT NULL DEFAULT 0,
  total_sku_count INT NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT uq_accounting_monthly_store_summary UNIQUE (store_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_accounting_monthly_store_summary_store_ym 
  ON accounting_monthly_store_summary (store_id, year, month);
