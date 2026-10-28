-- 119_ppc_keyword_search_volume.sql
-- SEARCH VOLUME cho Target / Search Term: cache volume tháng lấy từ Helium 10 (Cerebro theo ASIN đang chạy ads,
-- Magnet để lấp keyword còn thiếu). Volume là dữ liệu chung theo marketplace nên không gắn team.

CREATE TABLE IF NOT EXISTS keyword_search_volumes (
  marketplace TEXT NOT NULL DEFAULT 'US',
  keyword_norm TEXT NOT NULL,
  keyword TEXT NOT NULL,
  search_volume INTEGER,
  search_volume_trend NUMERIC(10, 2),
  cpc NUMERIC(10, 2),
  competing_products INTEGER,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (marketplace, keyword_norm)
);

CREATE INDEX IF NOT EXISTS idx_keyword_search_volumes_fetched ON keyword_search_volumes (fetched_at);

-- ASIN đã chạy Cerebro gần đây → bỏ qua để tiết kiệm lượt (Diamond: 250 lượt Cerebro/tháng)
CREATE TABLE IF NOT EXISTS keyword_search_volume_asin_queries (
  marketplace TEXT NOT NULL DEFAULT 'US',
  asin TEXT NOT NULL,
  keyword_count INTEGER NOT NULL DEFAULT 0,
  queried_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (marketplace, asin)
);

CREATE TABLE IF NOT EXISTS ppc_search_volume_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID REFERENCES ppc_stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  cerebro_calls INTEGER NOT NULL DEFAULT 0,
  magnet_calls INTEGER NOT NULL DEFAULT 0,
  asins_queried INTEGER NOT NULL DEFAULT 0,
  keywords_upserted INTEGER NOT NULL DEFAULT 0,
  missing_before INTEGER NOT NULL DEFAULT 0,
  missing_after INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ppc_search_volume_sync_runs_team ON ppc_search_volume_sync_runs (team_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppc_search_volume_sync_runs_month ON ppc_search_volume_sync_runs (started_at);
