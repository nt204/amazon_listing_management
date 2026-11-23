-- Auto giảm bid (lib/ppc/auto-decrease.ts): target có đề xuất GIẢM bid liên tục N ngày dữ liệu mà chưa ai xử lý
-- → 9h sáng (giờ VN) gửi thông báo cá nhân cho NGƯỜI ĐÃ CẤU HÌNH → bấm Xác nhận mới tạo Bulk và đẩy lên Amazon.
-- Mỗi người tự cấu hình cho từng store; người không cấu hình không nhận gì.

-- Cấu hình của từng người cho từng store.
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_settings (
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, actor_id)
);

-- Mỗi target đang có đề xuất giảm bid: đã thấy liên tục bao nhiêu ngày dữ liệu (report_end_date của snapshot 30 ngày).
-- Dùng chung cho mọi người (là dữ kiện của target). Đề xuất biến mất / đổi hướng / có người xử lý / bid bị đổi
-- → đếm lại từ đầu.
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, rec_id)
);

-- "Hoãn" của từng người: không nhắc lại target này cho người đó tới hết ngày snoozed_until.
-- Bộ đếm của target bắt đầu lại sau lúc hoãn (bid đổi, hết đề xuất…) thì lần hoãn tự hết hiệu lực.
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_snoozes (
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  rec_id TEXT NOT NULL,
  snoozed_until DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, actor_id, rec_id)
);

-- Mỗi người mỗi store mỗi ngày tối đa một lô, chỉ gửi cho người đó và chỉ người đó duyệt / hoãn.
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
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
  UNIQUE (store_id, actor_id, run_date)
);

CREATE INDEX IF NOT EXISTS ppc_auto_decrease_batches_actor_recent_idx
  ON ppc_auto_decrease_batches (store_id, actor_id, run_date DESC);

-- Khoá lượt chạy 9h mỗi ngày (nhiều tiến trình cùng chạy thì chỉ một tiến trình làm).
CREATE TABLE IF NOT EXISTS ppc_auto_decrease_runs (
  run_key TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB
);
