ALTER TABLE listings ADD COLUMN IF NOT EXISTS team_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE listing_revisions ADD COLUMN IF NOT EXISTS team_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE listing_revisions ADD COLUMN IF NOT EXISTS actor_id TEXT NOT NULL DEFAULT 'system';
ALTER TABLE listing_revisions ADD COLUMN IF NOT EXISTS instruction TEXT NOT NULL DEFAULT '';
ALTER TABLE listing_revisions ADD COLUMN IF NOT EXISTS quality_json JSONB;
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS team_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_profiles_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS brand_profiles_team_name_unique ON brand_profiles(team_id, name);
CREATE INDEX IF NOT EXISTS listings_team_updated_idx ON listings(team_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS listing_revisions_team_listing_idx ON listing_revisions(team_id, listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_profiles_team_name_idx ON brand_profiles(team_id, name);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  team_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, scope, bucket)
);

CREATE TABLE IF NOT EXISTS api_idempotency (
  team_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json JSONB,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, endpoint, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_team_created_idx ON audit_events(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_idempotency_created_idx ON api_idempotency(created_at);

UPDATE listings SET status = 'Draft' WHERE status = 'Generated';
UPDATE listings SET status = 'Review' WHERE status IN ('Needs Review', 'Rejected');
