CREATE TABLE IF NOT EXISTS shared_mockup_presets (
  team_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📦',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  contents_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, preset_id)
);

CREATE INDEX IF NOT EXISTS shared_mockup_presets_team_updated_idx
  ON shared_mockup_presets(team_id, updated_at DESC);
