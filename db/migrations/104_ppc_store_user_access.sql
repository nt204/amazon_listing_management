CREATE TABLE IF NOT EXISTS ppc_store_user_access (
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  can_ask_lark BOOLEAN NOT NULL DEFAULT FALSE,
  receive_action_notifications BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, store_id, actor_id),
  FOREIGN KEY (team_id, actor_id) REFERENCES app_users(team_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ppc_store_user_access_actor_idx
  ON ppc_store_user_access(team_id, actor_id, can_ask_lark);

CREATE INDEX IF NOT EXISTS ppc_store_user_access_notification_idx
  ON ppc_store_user_access(team_id, store_id, receive_action_notifications);
