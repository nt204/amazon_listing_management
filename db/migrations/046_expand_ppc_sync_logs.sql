-- Migration 046: Mở rộng nguồn log (source) và trạng thái (status) cho bảng ppc_sync_logs
-- Cho phép ghi nhận toàn diện: Tải file tự động (AdsPower Download), Nạp database (Data Ingest), Upload thủ công, R2, v.v.

ALTER TABLE ppc_sync_logs DROP CONSTRAINT IF EXISTS ppc_sync_logs_source_check;
ALTER TABLE ppc_sync_logs ADD CONSTRAINT ppc_sync_logs_source_check 
  CHECK (source IN ('CLOUDFLARE_R2', 'MANUAL_UPLOAD', 'MOCK_DATA', 'ADSPOWER_DOWNLOAD', 'DATA_INGEST', 'SYSTEM'));

ALTER TABLE ppc_sync_logs DROP CONSTRAINT IF EXISTS ppc_sync_logs_status_check;
ALTER TABLE ppc_sync_logs ADD CONSTRAINT ppc_sync_logs_status_check 
  CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED', 'RUNNING'));
