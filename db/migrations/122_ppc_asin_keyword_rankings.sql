-- 122_ppc_asin_keyword_rankings.sql
-- Lưu trữ Organic Rank và Sponsored Rank theo cặp (Marketplace, ASIN, Keyword) lấy từ Helium 10 Cerebro

CREATE TABLE IF NOT EXISTS ppc_asin_keyword_rankings (
  marketplace TEXT NOT NULL DEFAULT 'US',
  asin TEXT NOT NULL,
  keyword_norm TEXT NOT NULL,
  keyword TEXT NOT NULL,
  organic_rank INTEGER,
  sponsored_rank INTEGER,
  search_volume INTEGER,
  cpc NUMERIC(10, 2),
  cpr INTEGER,
  source TEXT NOT NULL DEFAULT 'helium10_cerebro',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (marketplace, asin, keyword_norm)
);

CREATE INDEX IF NOT EXISTS idx_ppc_asin_keyword_rankings_asin ON ppc_asin_keyword_rankings (marketplace, asin);
CREATE INDEX IF NOT EXISTS idx_ppc_asin_keyword_rankings_kw ON ppc_asin_keyword_rankings (marketplace, keyword_norm);
CREATE INDEX IF NOT EXISTS idx_ppc_asin_keyword_rankings_fetched ON ppc_asin_keyword_rankings (fetched_at);
