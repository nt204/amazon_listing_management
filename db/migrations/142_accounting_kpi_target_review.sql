-- 142_accounting_kpi_target_review.sql
-- CHI TIẾT SKU / CHI TIẾT SKU TEST, nhóm "Đánh giá mục tiêu" (tháng sau): hai ô leader ghi tay "Đánh giá" và "Action mục tiêu".
-- Lưu trên dòng mục tiêu của tháng đó (cùng chỗ Unit / TACoS mục tiêu).

ALTER TABLE accounting_kpi_targets
  ADD COLUMN IF NOT EXISTS review TEXT,
  ADD COLUMN IF NOT EXISTS target_action TEXT;
