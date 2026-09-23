-- A file accepted by Amazon is not necessarily processed successfully.

ALTER TABLE ppc_auto_upload_logs
  ADD COLUMN IF NOT EXISTS result_summary TEXT;

ALTER TABLE ppc_auto_upload_logs DROP CONSTRAINT IF EXISTS ppc_auto_upload_logs_status_check;
ALTER TABLE ppc_auto_upload_logs ADD CONSTRAINT ppc_auto_upload_logs_status_check
  CHECK (status IN (
    'PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCESS', 'PARTIAL_SUCCESS',
    'RESULT_TIMEOUT', 'FAILED', 'CANCELLED'
  ));

-- Older workers used SUCCESS to mean only "the Upload button was clicked".
-- Keep those jobs visible for manual verification and do not claim their
-- actions were applied by Amazon.
UPDATE ppc_actions AS action
SET status = 'APPROVED', updated_at = NOW()
FROM (
  SELECT jsonb_array_elements_text(action_ids)::uuid AS action_id
  FROM ppc_auto_upload_logs
  WHERE status = 'SUCCESS' AND stage = 'SUBMITTED_TO_AMAZON'
) AS legacy_submission
WHERE action.id = legacy_submission.action_id
  AND action.status = 'APPLIED';

UPDATE ppc_auto_upload_logs
SET status = 'RESULT_TIMEOUT',
    stage = 'AMAZON_RESULT_UNKNOWN',
    result_summary = COALESCE(
      result_summary,
      'Phiên bản worker cũ chỉ xác nhận Amazon đã nhận file; cần kiểm tra kết quả thủ công.'
    ),
    updated_at = NOW()
WHERE status = 'SUCCESS' AND stage = 'SUBMITTED_TO_AMAZON';
