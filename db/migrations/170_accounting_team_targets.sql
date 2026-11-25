-- 170_accounting_team_targets.sql
-- Mục tiêu sếp giao cho team qua Lark (tag bot vào tin nhắn) — lib/accounting/team-targets*.ts.
--
-- 1) accounting_team_target_drafts: mỗi tin nhắn tag bot được AI bóc thành 1 bản nháp (parsed = các mục tiêu đã đổi
--    ra khoảng ngày + cảnh báo). Bot trả card xác nhận; chỉ khi bấm Xác nhận mới ghi sang bảng mục tiêu.
-- 2) accounting_team_targets: mục tiêu đang áp dụng, báo cáo ngày đọc để hiện tiến độ của team.
--    kind: week_total (tổng 1 tuần) | daily_rate (mỗi ngày) | month_total (tổng tháng / còn lại) | margin_floor (margin tối thiểu, %)
--    end_date NULL: áp dụng tới khi có mức mới. Mục tiêu mới trùng loại + chỉ số + store + khoảng ngày thì mục tiêu cũ
--    chuyển 'superseded'.
-- 3) lark_chat_teams: nhóm Lark → team (khi tin không nhắc store/team). Tự ghi nhớ khi xác nhận lần đầu trong nhóm.

CREATE TABLE IF NOT EXISTS accounting_team_target_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  sender_open_id TEXT,
  raw_text TEXT NOT NULL,
  sent_date DATE NOT NULL,
  team TEXT,
  parsed JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounting_team_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES accounting_team_target_drafts(id) ON DELETE SET NULL,
  team TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('week_total', 'daily_rate', 'month_total', 'margin_floor')),
  metric TEXT NOT NULL CHECK (metric IN ('units', 'revenue', 'profit', 'margin')),
  store_name TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  value NUMERIC NOT NULL,
  comparator TEXT NOT NULL DEFAULT '>=' CHECK (comparator IN ('>=', '=')),
  is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  label TEXT NOT NULL,
  quote TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'cancelled')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS accounting_team_targets_active_idx
  ON accounting_team_targets (team, start_date)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS lark_chat_teams (
  chat_id TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
