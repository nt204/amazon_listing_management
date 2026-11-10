-- 144_accounting_kpi_sheet_targets.sql
-- Nạp mục tiêu từ file "<STORE> - KẾ HOẠCH KINH DOANH <năm>":
-- 1) accounting_kpi_targets thêm Basecost/unit và Amazon fee/unit leader điền trên sheet (cột H, I tab CHI TIẾT SKU).
--    Có giá trị thì mục tiêu tính theo đúng số sheet; trống thì dùng số hệ thống (giá vốn tháng, phí FBA Bảng mã).
-- 2) accounting_kpi_team_targets: mục tiêu tổng team của tháng khi sheet chỉ còn số tổng (vd [Target] T10 ở BÁO CÁO THÁNG 9
--    là số tĩnh, mục tiêu từng SKU của tháng đó đã bị ghi đè). Chỉ dùng khi tháng đó không có mục tiêu từng SKU.

ALTER TABLE accounting_kpi_targets
  ADD COLUMN IF NOT EXISTS basecost_unit NUMERIC,
  ADD COLUMN IF NOT EXISTS amazon_fee_unit NUMERIC;

CREATE TABLE IF NOT EXISTS accounting_kpi_team_targets (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  grp TEXT NOT NULL CHECK (grp IN ('dev', 'test')),
  metrics JSONB NOT NULL,
  source TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, period, grp)
);
