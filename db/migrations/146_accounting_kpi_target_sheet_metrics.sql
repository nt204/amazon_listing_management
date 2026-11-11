-- 146_accounting_kpi_target_sheet_metrics.sql
-- Mục tiêu từng SKU nạp từ sheet KẾ HOẠCH KINH DOANH: dòng mà leader gõ tay số (ô REV / Profit mục tiêu không phải
-- công thức) thì lưu nguyên các số của dòng đó (chi phí số dương) và dùng thay cho công thức tính mục tiêu.
-- Sửa Unit / TACoS / giá / lưu kho trên app thì xóa số này để tính lại theo công thức.

ALTER TABLE accounting_kpi_targets
  ADD COLUMN IF NOT EXISTS sheet_metrics JSONB;
