CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  internal_name TEXT NOT NULL,
  product_type TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  status TEXT NOT NULL,
  model_used TEXT NOT NULL,
  input_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  current_listing_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_revisions (
  id BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL DEFAULT 'default',
  actor_id TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  content_json JSONB NOT NULL,
  quality_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brand_profiles (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  guidelines TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, name)
);
