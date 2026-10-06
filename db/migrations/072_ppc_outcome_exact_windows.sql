-- Migration 072: Use exact half-open observation windows and invalidate estimated outcomes.

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
          'captured_by', 'db-trigger-v4-exact-windows'
        )
      );
    END IF;

    IF NEW.status = 'APPLIED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPLIED') THEN
      applied_on := CURRENT_DATE;
      attribution_days := CASE WHEN UPPER(NEW.campaign_type) LIKE 'SB%' THEN 14 ELSE 7 END;

      FOREACH outcome_window IN ARRAY ARRAY[3, 7, 14, 30]
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
          applied_on + 1 + outcome_window,
          applied_on + 1 + outcome_window + attribution_days,
          'OBSERVING',
          jsonb_build_object(
            'applied_on', applied_on,
            'attribution_days', attribution_days,
            'scheduled_by', 'db-trigger-v4-exact-windows'
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

-- Previously evaluated rows may contain pro-rated or pre-action observations.
-- Reset them so the worker recomputes only from reports matching the exact range.
UPDATE ppc_action_outcomes AS outcome
SET observation_start = source.applied_on + 1,
    observation_end = source.applied_on + 1 + outcome.window_days,
    maturity_date = source.applied_on + 1 + outcome.window_days + source.attribution_days,
    status = 'OBSERVING',
    baseline = '{}'::jsonb,
    observed = '{}'::jsonb,
    comparison = '{}'::jsonb,
    evidence_quality = jsonb_build_object(
      'applied_on', source.applied_on,
      'scheduled_by', 'migration-072-exact-windows',
      'invalidated_estimated_result', true
    ),
    outcome_label = NULL,
    evaluated_at = NULL,
    updated_at = NOW()
FROM (
  SELECT id,
         COALESCE(approved_at::date, created_at::date) AS applied_on,
         CASE WHEN UPPER(campaign_type) LIKE 'SB%' THEN 14 ELSE 7 END AS attribution_days
  FROM ppc_actions
) AS source
WHERE source.id = outcome.action_id
  AND outcome.window_days IN (3, 7, 14, 30);
