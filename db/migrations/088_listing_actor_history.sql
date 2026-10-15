-- Listing history belongs to the individual account that created it, not only
-- to the shared team. Existing rows cannot be attributed safely, so retain
-- them under a non-user legacy owner.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS actor_id TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS listings_team_actor_updated_idx
  ON listings(team_id, actor_id, updated_at DESC);
