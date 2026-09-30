-- Observe the existing PPC action lifecycle without changing its state machine.
-- Any sidecar failure is swallowed so established PPC writes keep succeeding.

CREATE OR REPLACE FUNCTION capture_ppc_action_memory_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lifecycle_event TEXT;
  applied_on DATE;
  attribution_days INTEGER;
  outcome_window INTEGER;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      lifecycle_event := 'ACTION_CREATED';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      lifecycle_event := CASE NEW.status
        WHEN 'APPROVED' THEN 'ACTION_APPROVED'
        WHEN 'QUEUED' THEN 'ACTION_QUEUED'
        WHEN 'EXPORTED' THEN 'ACTION_EXPORTED'
        WHEN 'APPLIED' THEN 'AMAZON_APPLIED'
        WHEN 'IGNORED' THEN 'ACTION_IGNORED'
        WHEN 'SUPERSEDED' THEN 'ACTION_SUPERSEDED'
        ELSE 'ACTION_STATUS_CHANGED'
      END;
    ELSIF NEW.final_value IS DISTINCT FROM OLD.final_value THEN
      lifecycle_event := 'APPROVED_VALUE_CHANGED';
    END IF;

    IF lifecycle_event IS NOT NULL THEN
      INSERT INTO ppc_action_events (
        action_id, event_type, actor_type, actor_id, from_status, to_status, event_data
      ) VALUES (
        NEW.id,
        lifecycle_event,
        CASE WHEN NEW.approved_by IS NULL THEN 'SYSTEM' ELSE 'USER' END,
        NEW.approved_by,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
        NEW.status,
        jsonb_build_object(
          'old_value', NEW.old_value,
          'rule_proposed_value', NEW.system_suggested_value,
          'final_value', NEW.final_value,
          'campaign_id', NEW.campaign_id,
          'target_id', NEW.target_id,
          'captured_by', 'db-trigger-v1'
        )
      );
    END IF;

    IF NEW.status = 'APPLIED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPLIED') THEN
      applied_on := CURRENT_DATE;
      attribution_days := CASE WHEN UPPER(NEW.campaign_type) LIKE 'SB%' THEN 14 ELSE 7 END;

      FOREACH outcome_window IN ARRAY ARRAY[7, 14, 30]
      LOOP
        INSERT INTO ppc_action_outcomes (
          action_id,
          window_days,
          observation_start,
          observation_end,
          maturity_date,
          status,
          evidence_quality
        ) VALUES (
          NEW.id,
          outcome_window,
          applied_on + 1,
          applied_on + outcome_window,
          applied_on + outcome_window + attribution_days,
          'OBSERVING',
          jsonb_build_object(
            'applied_on', applied_on,
            'attribution_days', attribution_days,
            'scheduled_by', 'db-trigger-v1'
          )
        )
        ON CONFLICT (action_id, window_days) DO NOTHING;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'PPC action memory sidecar write failed for action %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ppc_action_memory_lifecycle_trigger ON ppc_actions;

CREATE TRIGGER ppc_action_memory_lifecycle_trigger
AFTER INSERT OR UPDATE OF status, final_value ON ppc_actions
FOR EACH ROW
EXECUTE FUNCTION capture_ppc_action_memory_lifecycle();

-- Preserve a discoverable starting point for actions created before this lifecycle observer.
INSERT INTO ppc_action_events (
  action_id, event_type, actor_type, actor_id, to_status, event_data, created_at
)
SELECT
  action.id,
  'LEGACY_STATE_SNAPSHOT',
  'SYSTEM',
  action.approved_by,
  action.status,
  jsonb_build_object(
    'old_value', action.old_value,
    'rule_proposed_value', action.system_suggested_value,
    'final_value', action.final_value,
    'captured_by', 'migration-066'
  ),
  action.updated_at
FROM ppc_actions AS action
WHERE NOT EXISTS (
  SELECT 1 FROM ppc_action_events AS event WHERE event.action_id = action.id
);

