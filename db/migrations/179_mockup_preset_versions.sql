-- Lịch sử chỉnh sửa phôi mockup (prompt chung) để xem lại và khôi phục.
-- Mỗi dòng là trạng thái của phôi sau một lần lưu. Các lần lưu liên tiếp
-- của cùng một người trong vài phút được gộp vào một dòng (xử lý ở lib/db.ts).
CREATE TABLE IF NOT EXISTS shared_mockup_preset_versions (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📦',
  contents_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'edit'
    CHECK (source IN ('baseline', 'edit', 'restore')),
  restored_from_id BIGINT,
  saved_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shared_mockup_preset_versions_lookup_idx
  ON shared_mockup_preset_versions(team_id, preset_id, saved_at DESC, id DESC);

-- Bản gốc: trạng thái hiện tại của mọi phôi, để lần sửa đầu tiên vẫn khôi phục được.
INSERT INTO shared_mockup_preset_versions (
  team_id, preset_id, label, icon, contents_json, source, saved_by, created_at, saved_at
)
SELECT team_id, preset_id, label, icon, contents_json, 'baseline', updated_by, updated_at, updated_at
FROM shared_mockup_presets;
