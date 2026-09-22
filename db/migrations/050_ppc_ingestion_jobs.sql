CREATE TABLE IF NOT EXISTS ppc_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), team_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  batch_id TEXT NOT NULL, batch_date TEXT NOT NULL, store_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','RETRY_WAIT','COMPLETED','FAILED','CANCELLED')),
  stage TEXT NOT NULL DEFAULT 'QUEUED', progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 4,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), worker_id TEXT, lease_token UUID,
  lease_expires_at TIMESTAMPTZ, heartbeat_at TIMESTAMPTZ, result JSONB, error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, batch_id)
);
CREATE INDEX IF NOT EXISTS ppc_ingestion_jobs_queue_idx ON ppc_ingestion_jobs(status,next_attempt_at,created_at) WHERE status IN ('QUEUED','RETRY_WAIT');
CREATE INDEX IF NOT EXISTS ppc_ingestion_jobs_lease_idx ON ppc_ingestion_jobs(status,lease_expires_at) WHERE status='RUNNING';
