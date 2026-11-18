-- 155_accounting_kpi_store_plans.sql
-- Kế hoạch kinh doanh theo kỳ (Kỳ I = T1–T6, Kỳ II = T7–T12) của từng store — tab "Plan" của KPI kinh doanh,
-- mô phỏng file "THEO DÕI KẾ HOẠCH CÁC STORE" (mỗi store 1 tab, mỗi kỳ 1 khối: cột T{m} = kế hoạch, cột Result = kết quả).
--   plan         : số kế hoạch tháng (revenue, quantity, ads_fee, basecost, amazon_fee, ads_tax, tncn_tax, ref_tax,
--                  return_amount, storage_fee, profit) — nạp từ sheet hoặc sửa tay
--   sheet_result : cột Result đọc từ sheet, chỉ dùng khi tháng đó chưa có số chốt sổ trong accounting_monthly_store_summary

CREATE TABLE IF NOT EXISTS accounting_kpi_store_plans (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  sheet_result JSONB,
  source TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, period)
);
