-- 143_accounting_kpi_history_variant.sql
-- File KẾ HOẠCH KINH DOANH lấy số năm trước từ 2 tab khác công thức của file TỔNG KẾT năm trước:
--   cột "cùng kỳ năm trước"            ← tab SKU-monthly               (variant 'monthly')
--   cột "cùng kỳ tháng sau năm trước"  ← tab SKU FBA-monthly tổng hợp   (variant 'tonghop')
-- Lưu cả hai để mỗi cột khớp đúng sheet. storage_other = cột "Lưu kho + CP khác" của tab INPUT tương ứng
-- (SKU-monthly: M+N+O+P+Q+R+S; tổng hợp: M+N+O+P+Q+R+S theo bộ cột của tab đó).

ALTER TABLE accounting_kpi_sku_history
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS storage_other NUMERIC;

ALTER TABLE accounting_kpi_sku_history DROP CONSTRAINT IF EXISTS accounting_kpi_sku_history_pkey;
ALTER TABLE accounting_kpi_sku_history ADD PRIMARY KEY (store_id, period, sku, variant);
