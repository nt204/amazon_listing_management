-- Negative List: mỗi lần "Xuất File" là 1 lô (batch). Dòng phủ định của lô ở trạng thái 'exported' (file đã tải về,
-- CHƯA chắc đã lên Amazon) → không tính là đã phủ định, không chặn Auto Upload, không hiện ở Negative Hub.
-- Người dùng tick "Đã upload lên Amazon" → dòng chuyển 'enabled' và lô sang Negative Hub.
-- (Auto Upload vẫn dùng ppc_auto_upload_logs làm lô: source_job_id = id job, 'pending' → worker chuyển 'enabled'.)
CREATE TABLE IF NOT EXISTS ppc_negative_batches (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'NEGATIVE_LIST',
  file_name TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT 'negativePhrase',
  asins JSONB NOT NULL DEFAULT '[]'::jsonb,
  keyword_count INT NOT NULL DEFAULT 0,
  campaign_count INT NOT NULL DEFAULT 0,
  row_count INT NOT NULL DEFAULT 0,
  -- EXPORTED: đã tải file, chờ xác nhận · UPLOADED: đã xác nhận lên Amazon · CANCELLED: huỷ lô
  status TEXT NOT NULL DEFAULT 'EXPORTED',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ppc_negative_batches_store
  ON ppc_negative_batches (team_id, store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_neg_registry_job
  ON ppc_negative_registry (source_job_id)
  WHERE source_job_id IS NOT NULL;

-- Dữ liệu cũ: file Negative List đã xuất (source_job_id rỗng — chỉ "Xuất File" tạo kiểu này) trước đây bị ghi thẳng
-- 'enabled'. Gom theo store + phút xuất thành lô 'EXPORTED' để người dùng xác nhận lại đã upload hay chưa.
WITH legacy AS (
  SELECT r.team_id, r.store_id, max(r.store_name) AS store_name, r.match_type,
         date_trunc('minute', r.created_at) AS minute_at,
         count(*) AS row_count,
         count(DISTINCT lower(r.keyword_text)) AS keyword_count,
         count(DISTINCT r.campaign_name) AS campaign_count,
         'legacy-' || md5(r.store_id::text || r.match_type || date_trunc('minute', r.created_at)::text) AS batch_id
  FROM ppc_negative_registry r
  WHERE r.source = 'NEGATIVE_LIST' AND r.source_job_id IS NULL
  GROUP BY r.team_id, r.store_id, r.match_type, date_trunc('minute', r.created_at)
), ins AS (
  INSERT INTO ppc_negative_batches (
    id, team_id, store_id, store_name, source, file_name, match_type,
    keyword_count, campaign_count, row_count, status, created_at
  )
  SELECT batch_id, team_id, store_id, store_name, 'NEGATIVE_LIST',
         'File xuất lúc ' || to_char(minute_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY'),
         match_type, keyword_count, campaign_count, row_count, 'EXPORTED', minute_at
  FROM legacy
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE ppc_negative_registry r
SET state = 'exported',
    source_job_id = 'legacy-' || md5(r.store_id::text || r.match_type || date_trunc('minute', r.created_at)::text),
    updated_at = NOW()
WHERE r.source = 'NEGATIVE_LIST' AND r.source_job_id IS NULL;
