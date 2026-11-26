-- 163_trello_fba_boards.sql
-- Quản lý danh sách các Trello Boards của nhiều team để tự động bắt webhook và nạp phôi vào Bảng Mã

CREATE TABLE IF NOT EXISTS trello_fba_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id TEXT NOT NULL UNIQUE,
  board_name TEXT NOT NULL,
  target_list_name TEXT NOT NULL DEFAULT 'ĐI HÀNG FBA',
  target_list_id TEXT,
  webhook_id TEXT,
  default_store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trello_fba_boards_active ON trello_fba_boards(is_active);
