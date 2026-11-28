-- Cho phép tìm lần cập nhật mới nhất theo store/kênh bằng một lần đọc index.
CREATE INDEX IF NOT EXISTS idx_accounting_orders_freshness
  ON accounting_orders (store_id, fulfillment_channel, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounting_ads_freshness
  ON accounting_ads (store_id, upper(trim(loai)), updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounting_returns_freshness
  ON accounting_returns (store_id, upper(trim(loai)), updated_at DESC);
