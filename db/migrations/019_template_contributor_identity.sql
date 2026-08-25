ALTER TABLE amazon_shops
  ADD COLUMN IF NOT EXISTS contributor_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS amazon_shops_team_contributor_unique
  ON amazon_shops(team_id, contributor_id)
  WHERE contributor_id <> '';
