CREATE TABLE IF NOT EXISTS custom_mockup_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'box',
  name TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT 'Custom',
  description TEXT NOT NULL DEFAULT '',
  prompt_instruction TEXT NOT NULL DEFAULT '',
  image_data TEXT NOT NULL DEFAULT '',
  image_bytes BYTEA,
  image_content_type TEXT NOT NULL DEFAULT 'image/png',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_mockup_templates_team_cat_idx ON custom_mockup_templates (team_id, category, created_at DESC);
