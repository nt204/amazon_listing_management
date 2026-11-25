-- 169_accounting_weekly_unit_targets.sql
-- Báo cáo tuần → mục tiêu units của từng team cho từng tuần (chốt ở buổi check-in tuần, admin / kế toán điền ở bảng
-- Kinh doanh theo Team). Tách riêng mục tiêu tháng (sheet KPI). week_start = ngày đầu đoạn tuần như accounting_weekly_notes;
-- team = tên team của Báo cáo tuần (FBA TEAM 1, FBA TEAM 2, FBA TEAM 3, FBM).

CREATE TABLE IF NOT EXISTS accounting_weekly_unit_targets (
  week_start DATE NOT NULL,
  team TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week_start, team)
);
