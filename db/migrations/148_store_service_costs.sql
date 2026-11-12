-- 148_store_service_costs.sql
-- Phí dịch vụ của store dùng cho cột Net Profit tab FBA / FBM theo ngày (như file kế toán):
--   FBA: Net Profit = Profit − 20000 × service_rate ÷ 184 ngày (đã có cột service_rate)
--   FBM: Net Profit = Profit − fbm_service_cost ÷ 184 ngày (cột mới)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS fbm_service_cost NUMERIC;

-- Giá trị đang dùng trong file "FBA/FBM - FASTPEACE - KẾ TOÁN TỔNG HỢP 2026" (chỉ điền khi còn trống)
UPDATE stores SET service_rate = 0.2708 WHERE UPPER(TRIM(name)) = 'FASTPEACE' AND service_rate IS NULL;
UPDATE stores SET fbm_service_cost = 35000 WHERE UPPER(TRIM(name)) = 'FASTPEACE' AND fbm_service_cost IS NULL;
