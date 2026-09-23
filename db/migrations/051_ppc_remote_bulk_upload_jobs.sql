-- Remote queue for bulksheets generated on the server and uploaded by the Mac worker.

ALTER TABLE ppc_auto_upload_logs
  ADD COLUMN IF NOT EXISTS team_id TEXT,
  ADD COLUMN IF NOT EXISTS r2_key TEXT,
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS progress_pct INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amazon_upload_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS action_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE ppc_auto_upload_logs DROP CONSTRAINT IF EXISTS ppc_auto_upload_logs_status_check;
ALTER TABLE ppc_auto_upload_logs ADD CONSTRAINT ppc_auto_upload_logs_status_check
  CHECK (status IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCESS', 'FAILED', 'CANCELLED'));

CREATE INDEX IF NOT EXISTS ppc_auto_upload_logs_remote_queue_idx
  ON ppc_auto_upload_logs(status, lease_expires_at, created_at)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY_WAIT');

CREATE UNIQUE INDEX IF NOT EXISTS ppc_auto_upload_logs_store_sha_active_idx
  ON ppc_auto_upload_logs(store_id, sha256)
  WHERE sha256 IS NOT NULL AND status NOT IN ('FAILED', 'CANCELLED');
