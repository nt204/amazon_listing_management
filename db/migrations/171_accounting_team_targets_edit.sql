-- 171_accounting_team_targets_edit.sql
-- Mục tiêu team (170): sửa / xoá trên web (KPI kinh doanh → tab "Mục tiêu tuần") và xoá qua Lark ("xoá mục tiêu").
-- Xoá = status 'cancelled' (giữ lịch sử); ghi ai sửa / xoá lần cuối.

ALTER TABLE accounting_team_targets
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
