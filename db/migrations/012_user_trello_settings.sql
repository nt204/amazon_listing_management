CREATE TABLE IF NOT EXISTS user_trello_settings (
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, actor_id)
);

CREATE INDEX IF NOT EXISTS user_trello_settings_updated_at_idx
  ON user_trello_settings(updated_at DESC);
