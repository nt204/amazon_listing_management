-- Product policy tracks bid outcomes at D7 and D30 only.
-- A 14-day attribution delay may still apply to SB data; it is not an outcome window.

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
          'captured_by', 'db-trigger-v2'
        )
      );
    END IF;

    IF NEW.status = 'APPLIED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPLIED') THEN
      applied_on := CURRENT_DATE;
      attribution_days := CASE WHEN UPPER(NEW.campaign_type) LIKE 'SB%' THEN 14 ELSE 7 END;

      FOREACH outcome_window IN ARRAY ARRAY[7, 30]
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
            'scheduled_by', 'db-trigger-v2'
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

DELETE FROM ppc_action_outcomes WHERE window_days = 14;

