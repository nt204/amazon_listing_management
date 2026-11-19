-- Lên camp SKU mới: kho file keyword "Chia Part test" (thay bảng kw_files SQLite của tool NCE-Campaign-Auto-Web).
-- Tên file: "{Tên người} - {Ngách} - {Phôi} - {Bộ KW}.xlsx". File nhỏ (vài chục KB) nên lưu thẳng bytea.
CREATE TABLE IF NOT EXISTS ppc_new_camp_kw_files (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_data BYTEA NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppc_new_camp_kw_files_team_created
  ON ppc_new_camp_kw_files (team_id, created_at DESC);
