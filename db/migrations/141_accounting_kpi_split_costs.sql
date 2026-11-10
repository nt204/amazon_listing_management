-- 141_accounting_kpi_split_costs.sql
-- Tách chi phí như file KẾ HOẠCH KINH DOANH (BÁO CÁO THÁNG / CHI TIẾT SKU):
-- Thuế = Ads tax 10% Ads + TNCN tax 1% Rev + Ref tax; "Lưu kho + CP khác" = Adjustment + Lưu kho + Placement Fee + CP khác.
-- Cột thue / other_fee cũ giữ nguyên là tổng (thue = ads_tax + tncn_tax + ref_tax; other_fee = phần CP khác còn lại).

ALTER TABLE accounting_kpi_sku_history
  ADD COLUMN IF NOT EXISTS ads_tax NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tncn_tax NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ref_tax NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_fee NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS placement_fee NUMERIC NOT NULL DEFAULT 0;
