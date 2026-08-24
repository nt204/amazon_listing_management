DROP INDEX IF EXISTS mockup_jobs_one_active_card_idx;

CREATE INDEX IF NOT EXISTS mockup_jobs_active_card_idx
  ON mockup_jobs(team_id, card_id, created_at)
  WHERE status IN ('queued', 'running', 'cancel_requested');
