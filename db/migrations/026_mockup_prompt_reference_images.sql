CREATE TABLE IF NOT EXISTS mockup_prompt_reference_images (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  storage_scope TEXT NOT NULL CHECK (storage_scope IN ('shared', 'temporary')),
  preset_id TEXT,
  content_id INTEGER,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_bytes BYTEA,
  object_key TEXT,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mockup_prompt_reference_image_scope_check CHECK (
    (storage_scope = 'shared' AND preset_id IS NOT NULL AND content_id IS NOT NULL AND expires_at IS NULL)
    OR
    (storage_scope = 'temporary' AND preset_id IS NULL AND content_id IS NULL AND expires_at IS NOT NULL)
  ),
  CONSTRAINT mockup_prompt_reference_image_payload_check CHECK (
    image_bytes IS NOT NULL OR object_key IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS mockup_prompt_reference_images_shared_idx
  ON mockup_prompt_reference_images(team_id, preset_id, content_id, created_at)
  WHERE storage_scope = 'shared';

CREATE INDEX IF NOT EXISTS mockup_prompt_reference_images_expiry_idx
  ON mockup_prompt_reference_images(expires_at)
  WHERE storage_scope = 'temporary';
