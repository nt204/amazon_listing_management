-- 140_accounting_kpi.sql
-- Mục "KPI kinh doanh" (file "<STORE> - KẾ HOẠCH KINH DOANH 2026": BÁO CÁO THÁNG, CHI TIẾT SKU, CHI TIẾT SKU TEST).
--
-- 1) accounting_kpi_sku_history: kết quả từng SKU theo tháng của các năm hệ thống chưa có dữ liệu thô
--    (vd 2025 — file "TỔNG KẾT CUỐI THÁNG_<STORE> 2025"). Tính lại đúng công thức tab SKU-monthly từ các tab thô
--    (Basecost, Ads, Trans Rp, Lưu kho, Placement, Long-Term, Removal RP, Thanh lý) — lib/accounting/kpi-db.ts.
--    Chi phí lưu số dương; profit = revenue - ads - basecost - amazon_fee - thue - return - other_fee.
-- 2) accounting_kpi_targets: mục tiêu leader nhập cho từng SKU từng tháng (Unit, TACoS, giá, lưu kho dự tính)
--    + nguyên nhân / giải pháp / action. Revenue, chi phí, Profit mục tiêu tính từ các ô này.
-- 3) accounting_kpi_month_notes: ô "Đánh giá tổng quan" của tháng.

CREATE TABLE IF NOT EXISTS accounting_kpi_sku_history (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  sku TEXT NOT NULL,
  asin TEXT,
  product_type TEXT,
  status TEXT,
  revenue NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  ads_fee NUMERIC NOT NULL DEFAULT 0,
  basecost NUMERIC NOT NULL DEFAULT 0,
  amazon_fee NUMERIC NOT NULL DEFAULT 0,
  thue NUMERIC NOT NULL DEFAULT 0,
  return_amount NUMERIC NOT NULL DEFAULT 0,
  other_fee NUMERIC NOT NULL DEFAULT 0,
  profit NUMERIC NOT NULL DEFAULT 0,
  source TEXT,
  imported_by TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, period, sku)
);

CREATE TABLE IF NOT EXISTS accounting_kpi_targets (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  sku TEXT NOT NULL,
  units NUMERIC,
  tacos NUMERIC,
  price NUMERIC,
  storage_fee NUMERIC,
  cause TEXT,
  solution TEXT,
  action TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, period, sku)
);

CREATE TABLE IF NOT EXISTS accounting_kpi_month_notes (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, period)
);
