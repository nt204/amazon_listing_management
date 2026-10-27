-- 114_accounting_crawler_jobs.sql
-- Lệnh chạy crawler kế toán thủ công từ web (System Admin → Crawler).
-- Máy Mac (accounting_job_worker.ts) hỏi server định kỳ, nhận lệnh, chạy đúng script của lịch tự động
-- và gửi tiến độ / log về đây.

CREATE TABLE IF NOT EXISTS accounting_crawler_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawler TEXT NOT NULL CHECK (crawler IN ('accounting_daily', 'inventory_ledger', 'awd_ledger')),
  store_name TEXT,          -- NULL = tất cả store của máy Mac
  target_date DATE,         -- NULL = ngày mặc định của crawler
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  requested_by TEXT,
  worker_id TEXT,
  current_step TEXT,
  log_tail TEXT,
  exit_code INTEGER,
  error_message TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_accounting_crawler_jobs_status_created
  ON accounting_crawler_jobs (status, created_at);

-- Chống trùng: mỗi crawler chỉ có 1 lệnh đang chờ hoặc đang chạy
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_crawler_jobs_active
  ON accounting_crawler_jobs (crawler) WHERE status IN ('PENDING', 'RUNNING');

-- Máy Mac đang chạy worker (cập nhật mỗi lần hỏi lệnh) + danh sách store trong stores.json của máy đó
CREATE TABLE IF NOT EXISTS accounting_crawler_workers (
  worker_id TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stores JSONB NOT NULL DEFAULT '[]'::jsonb,
  info JSONB NOT NULL DEFAULT '{}'::jsonb
);
