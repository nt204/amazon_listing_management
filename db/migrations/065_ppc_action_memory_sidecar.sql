-- Sidecar storage for PPC bid-decision memory.
-- These tables are additive and do not change the existing recommendation,
-- action queue, bulk export, or Amazon upload contracts.

CREATE TABLE IF NOT EXISTS ppc_action_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL UNIQUE REFERENCES ppc_actions(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  decision_source TEXT NOT NULL DEFAULT 'RULE_ENGINE',
  data_as_of TIMESTAMPTZ NOT NULL,
  report_start_date DATE,
  report_end_date DATE,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_action_contexts_report_range_check CHECK (
    report_start_date IS NULL OR report_end_date IS NULL OR report_start_date <= report_end_date
  )
);

CREATE INDEX IF NOT EXISTS ppc_action_contexts_source_created_idx
  ON ppc_action_contexts(decision_source, created_at DESC);

CREATE INDEX IF NOT EXISTS ppc_action_contexts_data_as_of_idx
  ON ppc_action_contexts(data_as_of DESC);

CREATE TABLE IF NOT EXISTS ppc_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES ppc_actions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'SYSTEM',
  actor_id TEXT,
  from_status TEXT,
  to_status TEXT,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppc_action_events_action_created_idx
  ON ppc_action_events(action_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ppc_action_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES ppc_actions(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  window_days SMALLINT NOT NULL CHECK (window_days > 0),
  observation_start DATE NOT NULL,
  observation_end DATE NOT NULL,
  maturity_date DATE,
  status TEXT NOT NULL DEFAULT 'OBSERVING' CHECK (status IN (
    'OBSERVING', 'PROVISIONAL', 'MATURE', 'CONTAMINATED', 'INSUFFICIENT_DATA'
  )),
  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed JSONB NOT NULL DEFAULT '{}'::jsonb,
  comparison JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_label TEXT CHECK (
    outcome_label IS NULL OR outcome_label IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')
  ),
  evaluator_version TEXT NOT NULL DEFAULT 'outcome-v1',
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_action_outcomes_observation_range_check CHECK (
    observation_start <= observation_end
  ),
  CONSTRAINT ppc_action_outcomes_action_window_unique UNIQUE(action_id, window_days)
);

CREATE INDEX IF NOT EXISTS ppc_action_outcomes_status_window_idx
  ON ppc_action_outcomes(status, window_days, updated_at DESC);

CREATE INDEX IF NOT EXISTS ppc_action_outcomes_action_idx
  ON ppc_action_outcomes(action_id);

CREATE TABLE IF NOT EXISTS ppc_agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  resulting_action_id UUID REFERENCES ppc_actions(id) ON DELETE SET NULL,
  target_key TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  prompt_version TEXT,
  data_as_of TIMESTAMPTZ NOT NULL,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppc_agent_decisions_store_created_idx
  ON ppc_agent_decisions(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ppc_agent_decisions_target_created_idx
  ON ppc_agent_decisions(store_id, target_key, created_at DESC);
