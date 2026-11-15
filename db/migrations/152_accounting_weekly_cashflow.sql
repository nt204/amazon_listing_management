-- 152_accounting_weekly_cashflow.sql
-- Báo cáo tuần → mục "Tài chính & dòng tiền" (VI. của sheet BÁO CÁO TUẦN TỔNG HỢP), toàn công ty, mỗi đoạn tuần 1 dòng.
-- Kế toán / admin nhập Chi mua hàng, CPVH chung / Tiktok, Topup vốn, Tổng chi (data: JSON số); web lấy Payment
-- từ payout và tự tính Dòng tiền ròng, TỔNG CPVH, Tổng thu, Số dư quỹ đầu / cuối tuần (lib/accounting/weekly-cashflow.ts).

CREATE TABLE IF NOT EXISTS accounting_weekly_cashflow (
  week_start DATE PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
