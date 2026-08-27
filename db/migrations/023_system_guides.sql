CREATE TABLE IF NOT EXISTS system_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  byte_size BIGINT NOT NULL DEFAULT 0,
  pdf_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_guides_created_at_idx ON system_guides (created_at DESC);
