-- db/migrations/049_ppc_sync_jobs_resilience.sql
-- Nâng cấp ppc_sync_jobs cho mô hình lease, heartbeat và checkpoint từng report

ALTER TABLE ppc_sync_jobs
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS task_states JSONB DEFAULT '[]'::jsonb;

-- Nới lỏng CHECK constraint trên status để hỗ trợ RETRY_WAIT và CANCELLED
ALTER TABLE ppc_sync_jobs DROP CONSTRAINT IF EXISTS ppc_sync_jobs_status_check;
ALTER TABLE ppc_sync_jobs ADD CONSTRAINT ppc_sync_jobs_status_check
  CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRY_WAIT', 'CANCELLED'));

CREATE INDEX IF NOT EXISTS ppc_sync_jobs_lease_idx
  ON ppc_sync_jobs(status, lease_expires_at)
  WHERE status IN ('RUNNING', 'RETRY_WAIT');

CREATE INDEX IF NOT EXISTS ppc_sync_jobs_batch_id_idx
  ON ppc_sync_jobs(batch_id);

-- RETRY_WAIT vẫn là một job active; database phải chặn tạo job thứ hai cùng team.
DROP INDEX IF EXISTS ppc_sync_jobs_one_active_team_idx;
CREATE UNIQUE INDEX ppc_sync_jobs_one_active_team_idx
  ON ppc_sync_jobs(team_id)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY_WAIT');
