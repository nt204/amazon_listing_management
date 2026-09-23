-- Keep remote Bulk jobs safe for jsonb_array_elements_text(). Older rows may
-- contain a JSON scalar written by a previous application version.

UPDATE ppc_auto_upload_logs
SET action_ids = CASE
  -- postgres.js encoded JSON.stringify([...]) as a JSON string. Decode those
  -- valid legacy values so a successfully submitted job keeps its action IDs.
  WHEN jsonb_typeof(action_ids) = 'string'
    AND (action_ids #>> '{}') ~ '^\s*\[.*\]\s*$'
    THEN (action_ids #>> '{}')::jsonb
  ELSE '[]'::jsonb
END
WHERE action_ids IS NULL OR jsonb_typeof(action_ids) <> 'array';

ALTER TABLE ppc_auto_upload_logs
  DROP CONSTRAINT IF EXISTS ppc_auto_upload_logs_action_ids_array_check;

ALTER TABLE ppc_auto_upload_logs
  ADD CONSTRAINT ppc_auto_upload_logs_action_ids_array_check
  CHECK (jsonb_typeof(action_ids) = 'array');

-- A legacy worker callback could set the job to SUCCESS and then fail while
-- expanding the scalar. Reconcile those already-submitted jobs during deploy.
UPDATE ppc_actions AS action
SET status = 'APPLIED', updated_at = NOW()
FROM (
  SELECT jsonb_array_elements_text(action_ids)::uuid AS action_id
  FROM ppc_auto_upload_logs
  WHERE status = 'SUCCESS'
) AS submitted
WHERE action.id = submitted.action_id
  AND action.status <> 'APPLIED';
