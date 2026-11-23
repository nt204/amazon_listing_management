-- Auto giảm bid (lib/ppc/auto-decrease.ts): target có đề xuất GIẢM bid liên tục N ngày dữ liệu mà chưa ai xử lý
-- → 9h sáng (giờ VN) gửi thẻ Lark cá nhân cho người phụ trách store → bấm Xác nhận mới tạo Bulk và đẩy lên Amazon.

-- Cài đặt theo store (dùng chung cho tab Đề xuất & Auto Bid).
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_settings (
  store_id UUID PRIMARY KEY REFERENCES ppc_stores(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- ALL = mọi SKU của store; SKUS = chỉ các SKU trong danh sách skus.
  scope TEXT NOT NULL DEFAULT 'SKUS' CHECK (scope IN ('ALL', 'SKUS')),
  skus TEXT[] NOT NULL DEFAULT '{}',
  wait_days INTEGER NOT NULL DEFAULT 3 CHECK (wait_days BETWEEN 1 AND 30),
  -- Bid mới = bid đề xuất của rule, nhưng không bao giờ hạ xuống dưới mức này.
  min_bid NUMERIC(10, 2) NOT NULL DEFAULT 0.10 CHECK (min_bid >= 0.02),
  -- Target có chỉnh bid (bất kỳ nguồn nào) trong chừng này ngày thì bỏ qua để đủ thời gian quan sát.
  cooldown_days INTEGER NOT NULL DEFAULT 7 CHECK (cooldown_days BETWEEN 0 AND 60),
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mỗi target đang có đề xuất giảm bid: đã thấy liên tục bao nhiêu ngày dữ liệu (report_end_date của snapshot 30 ngày).
-- Đề xuất biến mất / đổi hướng / có người xử lý → xoá dòng, đếm lại từ đầu.
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_streaks (
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  rec_id TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL DEFAULT '',
  first_seen_date DATE NOT NULL,
  last_seen_date DATE NOT NULL,
  seen_days INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_bid NUMERIC(10, 2),
  recommended_bid NUMERIC(10, 2),
  -- Người dùng bấm "Hoãn" trên Lark: không nhắc lại target này tới hết ngày này.
  snoozed_until DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, rec_id)
);

-- Mỗi store mỗi ngày tối đa một lô (một thẻ Lark gửi cho mọi người phụ trách store).
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMING', 'DONE', 'FAILED', 'SNOOZED', 'EXPIRED')),
  item_count INTEGER NOT NULL DEFAULT 0,
  -- Ảnh chụp các target lúc gửi: rec_id, sku, keyword, current_bid, final_bid, ...
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  decided_by TEXT,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  decided_via TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, run_date)
);

CREATE INDEX IF NOT EXISTS ppc_auto_decrease_batches_store_recent_idx
  ON ppc_auto_decrease_batches (store_id, run_date DESC);

-- Khoá lượt chạy 9h mỗi ngày (nhiều tiến trình cùng chạy thì chỉ một tiến trình làm).
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_runs (
  run_key TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB
);
