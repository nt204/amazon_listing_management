CREATE TABLE IF NOT EXISTS ppc_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  current_step TEXT NOT NULL DEFAULT '',
  total_files INTEGER NOT NULL DEFAULT 6 CHECK (total_files >= 0),
  processed_files INTEGER NOT NULL DEFAULT 0 CHECK (processed_files >= 0),
  error_message TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppc_sync_jobs_team_queue_idx
  ON ppc_sync_jobs(team_id, status, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS ppc_sync_jobs_one_active_team_idx
  ON ppc_sync_jobs(team_id)
  WHERE status IN ('PENDING', 'RUNNING');
