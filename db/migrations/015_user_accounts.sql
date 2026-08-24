CREATE TABLE IF NOT EXISTS app_users (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor'
    CHECK (role IN ('editor', 'reviewer', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_team_username_unique
  ON app_users(team_id, LOWER(username));

CREATE INDEX IF NOT EXISTS app_users_team_status_created_idx
  ON app_users(team_id, status, created_at DESC);
