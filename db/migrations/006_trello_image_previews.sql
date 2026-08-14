CREATE TABLE IF NOT EXISTS trello_image_previews (
  team_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('preview', 'thumbnail')),
  mime_type TEXT NOT NULL,
  image_bytes BYTEA NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, card_id, attachment_id, variant)
);

CREATE INDEX IF NOT EXISTS trello_image_previews_attachment_idx
  ON trello_image_previews(team_id, attachment_id);

CREATE INDEX IF NOT EXISTS trello_image_previews_updated_idx
  ON trello_image_previews(updated_at);
