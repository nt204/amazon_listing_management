CREATE TABLE IF NOT EXISTS mockup_jobs (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  request_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'completed', 'partial', 'failed',
      'cancel_requested', 'cancelled'
    )),
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  priority INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  lock_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mockup_jobs_one_active_card_idx
  ON mockup_jobs(team_id, card_id)
  WHERE status IN ('queued', 'running', 'cancel_requested');

CREATE INDEX IF NOT EXISTS mockup_jobs_claim_idx
  ON mockup_jobs(status, available_at, priority DESC, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS mockup_jobs_team_created_idx
  ON mockup_jobs(team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mockup_job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES mockup_jobs(id) ON DELETE CASCADE,
  event_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mockup_job_events_job_id_idx
  ON mockup_job_events(job_id, id);
