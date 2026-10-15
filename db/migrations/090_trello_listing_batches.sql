-- db/migrations/090_trello_listing_batches.sql
-- Persistent background jobs for Trello Batch Listing

CREATE TABLE IF NOT EXISTS trello_listing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  brand_profile_id UUID NOT NULL,
  brand_name TEXT,
  shop_id UUID NOT NULL,
  shop_name TEXT,
  template_id UUID NOT NULL,
  template_name TEXT,
  marketplace TEXT NOT NULL DEFAULT 'US',
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  total_cards INTEGER NOT NULL DEFAULT 0,
  completed_cards INTEGER NOT NULL DEFAULT 0,
  failed_cards INTEGER NOT NULL DEFAULT 0,
  concurrency INTEGER NOT NULL DEFAULT 2,
  zip_r2_key TEXT,
  zip_url TEXT,
  zip_filename TEXT,
  excel_combined_r2_key TEXT,
  excel_combined_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trello_listing_batches_team ON trello_listing_batches(team_id, status);
CREATE INDEX IF NOT EXISTS idx_trello_listing_batches_created ON trello_listing_batches(created_at DESC);

CREATE TABLE IF NOT EXISTS trello_listing_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES trello_listing_batches(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  sku TEXT,
  item_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT,
  stage_message TEXT,
  listing_id UUID,
  trello_attachment_id TEXT,
  excel_r2_key TEXT,
  excel_url TEXT,
  excel_filename TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  timings_ms JSONB DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trello_listing_batch_items_batch ON trello_listing_batch_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_trello_listing_batch_items_card ON trello_listing_batch_items(card_id);
