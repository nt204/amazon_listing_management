-- Add completed_at and claimed_at to ppc_sync_jobs if they do not exist
ALTER TABLE ppc_sync_jobs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
