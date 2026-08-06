CREATE TABLE IF NOT EXISTS listing_images (
  id UUID PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  image_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  image_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, image_index)
);

CREATE INDEX IF NOT EXISTS listing_images_team_listing_idx ON listing_images(team_id, listing_id);
CREATE INDEX IF NOT EXISTS listing_images_team_sha_idx ON listing_images(team_id, sha256);
