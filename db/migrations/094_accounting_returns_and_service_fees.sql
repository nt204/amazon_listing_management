-- db/migrations/094_accounting_returns_and_service_fees.sql
-- Tables to store Amazon Returns (Refunds) and Service Fees data

CREATE TABLE IF NOT EXISTS accounting_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  order_id TEXT NOT NULL,
  sku TEXT DEFAULT '',
  loai TEXT DEFAULT 'FBA',
  pic TEXT DEFAULT '',
  basecost NUMERIC DEFAULT 0,
  transaction_status TEXT DEFAULT 'Released',
  transaction_type TEXT DEFAULT 'Refund',
  product_details TEXT DEFAULT '',
  total_product_charges NUMERIC DEFAULT 0,
  total_promotional_rebates NUMERIC DEFAULT 0,
  amazon_fees NUMERIC DEFAULT 0,
  other NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  return_sau_basecost NUMERIC DEFAULT 0,
  tuan INTEGER DEFAULT 0,
  thang INTEGER DEFAULT 0,
  quy INTEGER DEFAULT 0,
  trang_thai TEXT DEFAULT 'Phát triển',
  row_hash TEXT NOT NULL,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_returns_store_row_hash UNIQUE (store_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_accounting_returns_store_date ON accounting_returns (store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_returns_store_sku ON accounting_returns (store_id, sku);
CREATE INDEX IF NOT EXISTS idx_accounting_returns_order_id ON accounting_returns (store_id, order_id);
CREATE INDEX IF NOT EXISTS idx_accounting_returns_date ON accounting_returns (date DESC);

CREATE TABLE IF NOT EXISTS accounting_service_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  transaction_type TEXT DEFAULT 'Service Fees',
  order_id TEXT DEFAULT '',
  product_details TEXT DEFAULT '',
  transaction_status TEXT DEFAULT 'Released',
  total_product_charges NUMERIC DEFAULT 0,
  total_promotional_rebates NUMERIC DEFAULT 0,
  amazon_fees NUMERIC DEFAULT 0,
  other NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  store_name TEXT DEFAULT '',
  thang INTEGER DEFAULT 0,
  tuan INTEGER DEFAULT 0,
  quy INTEGER DEFAULT 0,
  row_hash TEXT NOT NULL,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_service_fees_store_row_hash UNIQUE (store_id, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_accounting_service_fees_store_date ON accounting_service_fees (store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_service_fees_order_id ON accounting_service_fees (store_id, order_id);
CREATE INDEX IF NOT EXISTS idx_accounting_service_fees_product_details ON accounting_service_fees (store_id, product_details);
CREATE INDEX IF NOT EXISTS idx_accounting_service_fees_date ON accounting_service_fees (date DESC);
