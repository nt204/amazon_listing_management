-- 127_ppc_search_volume_checkpoint.sql
-- Checkpoint / resume cho crawl Helium 10 Cerebro:
-- - Mỗi ASIN ghi trạng thái riêng (ok / failed + số lần thử) → lượt sau chỉ quét ASIN còn thiếu, ASIN lỗi được thử lại
--   chứ không bị khóa 30 ngày như trước.
-- - Run có heartbeat + tổng ASIN/keyword thật để UI hiển thị tiến độ đúng và phát hiện tiến trình chết (server restart).

ALTER TABLE keyword_search_volume_asin_queries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Trước đây ASIN lỗi (cookie hết hạn, 502...) bị ghi keyword_count = 0 như đã quét → mở lại để thử lại
UPDATE keyword_search_volume_asin_queries
SET status = 'failed', attempts = 1
WHERE keyword_count = 0 AND status = 'ok';

ALTER TABLE ppc_search_volume_sync_runs
  ADD COLUMN IF NOT EXISTS asins_total INTEGER,
  ADD COLUMN IF NOT EXISTS asins_done INTEGER,
  ADD COLUMN IF NOT EXISTS keywords_total INTEGER,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resumed_from UUID;

ALTER TABLE ppc_search_volume_sync_runs DROP CONSTRAINT IF EXISTS ppc_search_volume_sync_runs_status_check;
ALTER TABLE ppc_search_volume_sync_runs
  ADD CONSTRAINT ppc_search_volume_sync_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'interrupted'));

-- Run "Đã dừng theo yêu cầu" cũ thực chất là tạm dừng, dữ liệu vẫn giữ → chuyển sang interrupted
UPDATE ppc_search_volume_sync_runs
SET status = 'interrupted'
WHERE status = 'failed' AND message = 'Đã dừng theo yêu cầu của người dùng.';
