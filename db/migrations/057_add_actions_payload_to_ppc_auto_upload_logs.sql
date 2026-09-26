-- db/migrations/057_add_actions_payload_to_ppc_auto_upload_logs.sql
-- Lưu chi tiết các hành động (như ST Optimization hoặc custom payload) trực tiếp trong log run

ALTER TABLE ppc_auto_upload_logs
  ADD COLUMN IF NOT EXISTS actions_payload JSONB DEFAULT '[]'::jsonb;
