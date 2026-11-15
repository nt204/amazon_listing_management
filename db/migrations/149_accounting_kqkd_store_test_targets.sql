-- 149_accounting_kqkd_store_test_targets.sql
-- Tab KPI kinh doanh → bảng "R&D Testing (tháng)": đầu tháng đặt KPI số mẫu test đi hàng cho CẢ STORE.
-- Result = số SKU test listing trong tháng, % mục tiêu = Result ÷ Target.

CREATE TABLE IF NOT EXISTS accounting_kqkd_store_test_targets (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  target INTEGER NOT NULL CHECK (target >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, month)
);
