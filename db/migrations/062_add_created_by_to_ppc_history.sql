-- db/migrations/062_add_created_by_to_ppc_history.sql
-- Thêm cột created_by để lưu thông tin tài khoản đã thực hiện action/upload/export

ALTER TABLE ppc_auto_upload_logs
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE bulk_exports
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Backfill performer email từ result_summary cho các bản ghi cũ nếu có
UPDATE ppc_auto_upload_logs
SET created_by = substring(result_summary FROM '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
WHERE created_by IS NULL AND result_summary IS NOT NULL;
