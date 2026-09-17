-- db/migrations/041_ppc_auto_upload_logs.sql
-- Bảng lưu lịch sử tự động xuất và upload file Bulk lên Amazon Ads qua AdsPower

CREATE TABLE IF NOT EXISTS ppc_auto_upload_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  adspower_profile_id TEXT,
  adspower_profile_name TEXT,
  action_count INTEGER NOT NULL DEFAULT 0,
  skus JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED', 'RUNNING'
  error_message TEXT,
  duration_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ppc_auto_upload_logs_store_idx 
  ON ppc_auto_upload_logs(store_id, created_at DESC);
