ALTER TABLE user_trello_settings
  ADD COLUMN IF NOT EXISTS listing_source_list_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS listing_target_list_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mockup_source_list_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mockup_target_list_id TEXT NOT NULL DEFAULT '';
