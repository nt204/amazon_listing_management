-- Atomically hand a completed Mac crawl to the single server ingestion worker.

ALTER TABLE ppc_ingestion_jobs
  ADD COLUMN IF NOT EXISTS crawler_job_id UUID REFERENCES ppc_sync_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ppc_ingestion_jobs_crawler_job_idx
  ON ppc_ingestion_jobs(crawler_job_id)
  WHERE crawler_job_id IS NOT NULL;

-- The production ingestion process is intentionally single-concurrency to cap RAM.
CREATE UNIQUE INDEX IF NOT EXISTS ppc_ingestion_jobs_one_running_idx
  ON ppc_ingestion_jobs ((1))
  WHERE status = 'RUNNING';

ALTER TABLE ppc_sync_jobs DROP CONSTRAINT IF EXISTS ppc_sync_jobs_status_check;
ALTER TABLE ppc_sync_jobs ADD CONSTRAINT ppc_sync_jobs_status_check
  CHECK (status IN ('PENDING', 'RUNNING', 'INGESTING', 'COMPLETED', 'FAILED', 'RETRY_WAIT', 'CANCELLED'));

DROP INDEX IF EXISTS ppc_sync_jobs_one_active_store_idx;
CREATE UNIQUE INDEX ppc_sync_jobs_one_active_store_idx
  ON ppc_sync_jobs(team_id, lower(store_name))
  WHERE status IN ('PENDING', 'RUNNING', 'INGESTING', 'RETRY_WAIT');

CREATE INDEX IF NOT EXISTS ppc_sync_jobs_ingesting_idx
  ON ppc_sync_jobs(team_id, status, updated_at)
  WHERE status = 'INGESTING';
