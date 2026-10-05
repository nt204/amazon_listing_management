-- Migration 069: Expand ppc_action_outcomes status and label constraints for full state machine

ALTER TABLE ppc_action_outcomes DROP CONSTRAINT IF EXISTS ppc_action_outcomes_status_check;

ALTER TABLE ppc_action_outcomes ADD CONSTRAINT ppc_action_outcomes_status_check CHECK (
  status IN (
    'OBSERVING',
    'PROVISIONAL',
    'READY',
    'MATURE',
    'FINALIZED',
    'CONTAMINATED',
    'INTERRUPTED',
    'SUPERSEDED',
    'INSUFFICIENT_DATA'
  )
);

ALTER TABLE ppc_action_outcomes DROP CONSTRAINT IF EXISTS ppc_action_outcomes_outcome_label_check;

ALTER TABLE ppc_action_outcomes ADD CONSTRAINT ppc_action_outcomes_outcome_label_check CHECK (
  outcome_label IS NULL OR outcome_label IN (
    'POSITIVE',
    'NEUTRAL',
    'NEGATIVE',
    'INCONCLUSIVE',
    'CONFOUNDED',
    'INTERRUPTED',
    'SUPERSEDED'
  )
);
