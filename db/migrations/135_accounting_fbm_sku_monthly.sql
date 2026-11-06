-- 135_accounting_fbm_sku_monthly.sql
-- SKU FBM-monthly: tab "SKU FBM-monthly" của file TỔNG KẾT CUỐI THÁNG (store có team FBM).
-- Kỳ chưa có file thô Amazon (2026-01..08) nạp từ Google Sheet (scripts/load_fbm_monthly_from_sheet.py, data_source = 'file');
-- kỳ có file thô tính từ R2 (scripts/ingest_monthly_from_raw.py → fbm_monthly_raw.py, data_source = NULL).
-- Profit = Revenue + Ads + Basecost + Amazon fee (2 loại) + Thuế + Return + A-to-z + Chargeback;
-- net_profit của store = tổng Profit SKU + owner_fee (phí chủ store, chỉ store có ô V2 trên tab — FASTPEACE).
-- Mỗi dòng = 1 sản phẩm SKU + ASIN: cùng SKU khác ASIN là 2 sản phẩm (asin '' khi bảng mã không có ASIN).

CREATE TABLE IF NOT EXISTS accounting_fbm_sku_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  sku TEXT NOT NULL,
  asin TEXT NOT NULL DEFAULT '',
  product_type TEXT,
  status TEXT,

  revenue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 0,
  ads_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost NUMERIC(14, 4) NOT NULL DEFAULT 0,
  amazon_fee_unrecognized NUMERIC(14, 4) NOT NULL DEFAULT 0,
  amazon_fee_trans NUMERIC(14, 4) NOT NULL DEFAULT 0,
  thue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  return_amount NUMERIC(14, 4) NOT NULL DEFAULT 0,
  a_to_z_claim NUMERIC(14, 4) NOT NULL DEFAULT 0,
  chargeback_refund NUMERIC(14, 4) NOT NULL DEFAULT 0,
  profit NUMERIC(14, 4) NOT NULL DEFAULT 0,
  revenue_ads NUMERIC(14, 4) NOT NULL DEFAULT 0,

  tacos NUMERIC(18, 6),
  acos NUMERIC(18, 6),
  margin NUMERIC(18, 6),
  roi NUMERIC(18, 6),
  profit_per_item NUMERIC(14, 4),
  basecost_per_item NUMERIC(14, 4),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_fbm_sku_monthly UNIQUE (store_id, year, month, sku, asin)
);

CREATE INDEX IF NOT EXISTS idx_accounting_fbm_sku_monthly_store_ym
  ON accounting_fbm_sku_monthly (store_id, year, month);

CREATE TABLE IF NOT EXISTS accounting_fbm_monthly_store_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),

  total_revenue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_quantity INT NOT NULL DEFAULT 0,
  total_ads_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_basecost NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_amazon_fee_unrecognized NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_amazon_fee_trans NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_thue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_return_amount NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_a_to_z_claim NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_chargeback_refund NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_sku_profit NUMERIC(14, 4) NOT NULL DEFAULT 0,
  owner_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_revenue_ads NUMERIC(14, 4) NOT NULL DEFAULT 0,

  tacos NUMERIC(18, 6),
  acos NUMERIC(18, 6),
  margin NUMERIC(18, 6),
  roi NUMERIC(18, 6),
  active_sku_count INT NOT NULL DEFAULT 0,
  total_sku_count INT NOT NULL DEFAULT 0,
  data_source TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_fbm_monthly_store_summary UNIQUE (store_id, year, month)
);

-- Hàng đợi tính lại SKU FBM-monthly từ file thô trên R2 (nút "Tính từ file thô" của tab), tách khỏi hàng đợi FBA
-- để tính lại FBM không ghi đè kỳ FBA nạp từ file TỔNG KẾT và ngược lại.
CREATE TABLE IF NOT EXISTS accounting_fbm_sku_monthly_recalc_queue (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (store_id, period)
);
