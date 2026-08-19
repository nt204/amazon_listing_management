CREATE TABLE IF NOT EXISTS shared_mockup_preset_state (
  team_id TEXT PRIMARY KEY,
  legacy_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
