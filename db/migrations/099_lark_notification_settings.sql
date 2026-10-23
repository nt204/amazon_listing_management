CREATE TABLE IF NOT EXISTS lark_user_connections (
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  receive_id TEXT NOT NULL,
  receive_id_type TEXT NOT NULL DEFAULT 'email'
    CHECK (receive_id_type IN ('email', 'open_id', 'user_id')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, actor_id)
);

CREATE TABLE IF NOT EXISTS lark_notification_preferences (
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('listing', 'ppc', 'accounting')),
  personal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, actor_id, category)
);

CREATE TABLE IF NOT EXISTS lark_team_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, chat_id)
);

CREATE TABLE IF NOT EXISTS lark_team_notification_rules (
  team_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('listing', 'ppc', 'accounting')),
  channel_id UUID REFERENCES lark_team_channels(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, category)
);

CREATE INDEX IF NOT EXISTS lark_team_channels_team_idx
  ON lark_team_channels(team_id, enabled, name);
