-- Queue one daily crawl job per store while keeping a single active Mac executor.

ALTER TABLE ppc_sync_jobs
  ADD COLUMN IF NOT EXISTS enqueue_key TEXT;

-- The old index allowed only one queued/running job for the whole team.
DROP INDEX IF EXISTS ppc_sync_jobs_one_active_team_idx;

-- Multiple stores may wait in PENDING, but the Mac must execute only one at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ppc_sync_jobs_one_running_team_idx
  ON ppc_sync_jobs(team_id)
  WHERE status = 'RUNNING';

-- Prevent two unfinished jobs for the same store (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS ppc_sync_jobs_one_active_store_idx
  ON ppc_sync_jobs(team_id, lower(store_name))
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY_WAIT');

-- Scheduler retries and repeated launchd invocations are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS ppc_sync_jobs_enqueue_key_idx
  ON ppc_sync_jobs(team_id, enqueue_key)
  WHERE enqueue_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ppc_sync_jobs_pending_fifo_idx
  ON ppc_sync_jobs(team_id, created_at ASC)
  WHERE status IN ('PENDING', 'RETRY_WAIT');
