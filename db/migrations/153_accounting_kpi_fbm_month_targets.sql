-- 153_accounting_kpi_fbm_month_targets.sql
-- Mục tiêu tháng của kênh FBM theo store, nạp từ file "FBM - <STORE> - KẾ HOẠCH KINH DOANH" (mỗi tab "Tháng MYYYY",
-- cột "[Target] T{M}/{YYYY}", dòng tổng Revenue / Quantity / Ads Fee / … / Profit). Báo cáo tuần dùng làm MT của dòng "(FBM)".

CREATE TABLE IF NOT EXISTS accounting_kpi_fbm_month_targets (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  quantity NUMERIC(14, 2) NOT NULL DEFAULT 0,
  profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, period)
);
