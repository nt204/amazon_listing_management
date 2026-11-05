-- 134_accounting_monthly_summary_data_source.sql
-- Nguồn số SKU Monthly của kỳ: NULL = tính từ file thô Amazon (scripts/ingest_monthly_from_raw.py),
-- 'file' = nạp theo công thức tab SKU-monthly của file TỔNG KẾT CUỐI THÁNG (kỳ không có file thô / chốt theo kế toán).
-- Kỳ 'file' không bị worker tự tính lại từ R2 sau khi Base Cost đổi (lib/accounting/sku-monthly-recalc.ts);
-- bấm "Tính lại" trên trang SKU Monthly vẫn chuyển kỳ đó sang số file thô.

ALTER TABLE accounting_monthly_store_summary
  ADD COLUMN IF NOT EXISTS data_source TEXT;
