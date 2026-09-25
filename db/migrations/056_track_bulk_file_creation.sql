-- Track file generation separately from the later Amazon upload result.

ALTER TABLE ppc_auto_upload_logs
  ALTER COLUMN file_name DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS file_status TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS file_error_message TEXT;

ALTER TABLE ppc_auto_upload_logs
  DROP CONSTRAINT IF EXISTS ppc_auto_upload_logs_file_status_check;

ALTER TABLE ppc_auto_upload_logs
  ADD CONSTRAINT ppc_auto_upload_logs_file_status_check
  CHECK (file_status IN ('PENDING', 'SUCCESS', 'FAILED'));

UPDATE ppc_auto_upload_logs
SET file_status = CASE
  WHEN stage = 'FILE_GENERATION_FAILED' THEN 'FAILED'
  ELSE 'SUCCESS'
END
WHERE file_status IS NULL OR file_status = 'PENDING';
