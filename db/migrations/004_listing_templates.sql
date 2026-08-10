CREATE TABLE IF NOT EXISTS listing_templates (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  workbook_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_templates_team_name_unique
  ON listing_templates(team_id, LOWER(name));
CREATE INDEX IF NOT EXISTS listing_templates_team_updated_idx
  ON listing_templates(team_id, updated_at DESC);
