-- 108_inventory_sheet_sync.sql
-- Đồng bộ BẢNG MÃ / CHI TIẾT ĐI HÀNG / BẢNG MÃ FBM từ link Google Sheet theo từng store.

-- Cột có trên sheet BẢNG MÃ của các store nhưng chưa có trong DB.
ALTER TABLE accounting_sku_master
  ADD COLUMN IF NOT EXISTS kich_thuoc TEXT,
  ADD COLUMN IF NOT EXISTS phan_loai_kich_thuoc TEXT,
  ADD COLUMN IF NOT EXISTS file_design TEXT;

-- Mỗi store có tối đa 1 link cho mỗi loại sheet.
CREATE TABLE IF NOT EXISTS inventory_sheet_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sheet_type TEXT NOT NULL CHECK (sheet_type IN ('sku', 'sku_fbm', 'inbound')),
  sheet_url TEXT NOT NULL,
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_title TEXT,
  tab_title TEXT,
  last_synced_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('success', 'error')),
  last_error TEXT,
  last_result JSONB,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_sheet_links_store_type UNIQUE (store_id, sheet_type)
);

-- Nhật ký từng lần đồng bộ (thủ công, nút tải lại, lịch 9h sáng).
CREATE TABLE IF NOT EXISTS inventory_sheet_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID REFERENCES inventory_sheet_links(id) ON DELETE SET NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sheet_type TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('link_saved', 'manual', 'reload', 'schedule')),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  result JSONB,
  error TEXT,
  triggered_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_sheet_sync_runs_store
  ON inventory_sheet_sync_runs (store_id, sheet_type, started_at DESC);

-- Khóa chạy lịch hằng ngày: mỗi ngày chỉ 1 tiến trình được chạy (kể cả khi có nhiều server).
CREATE TABLE IF NOT EXISTS inventory_sheet_schedule_runs (
  run_key TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB
);
