-- 118_fbm_pw_costs.sql
-- BASECOST THÁNG FBM: bản sao nguyên văn tab "ĐẦU VÀO FBM PW" của file KẾ TOÁN TỔNG HỢP FBM (link Google Sheet riêng
-- của store có team FBM, đồng bộ cùng lịch với Bảng Mã FBM). Sheet không có khóa duy nhất (1 đơn nhiều dòng, có dòng trùng)
-- nên mỗi lần đồng bộ thay toàn bộ dòng của store theo đúng thứ tự trên sheet (row_no).

CREATE TABLE IF NOT EXISTS accounting_fbm_pw_costs (
  id BIGSERIAL PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  order_id TEXT,
  pw_order_id TEXT,
  order_name TEXT,
  net_price NUMERIC(14, 4),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fbm_pw_costs_store_row ON accounting_fbm_pw_costs (store_id, row_no);
CREATE INDEX IF NOT EXISTS idx_fbm_pw_costs_store_order ON accounting_fbm_pw_costs (store_id, order_id);

-- Nối dòng PW với đơn hàng (ngày, SKU, số lượng) theo Order ID
CREATE INDEX IF NOT EXISTS idx_accounting_orders_store_order ON accounting_orders (store_id, amazon_order_id);

ALTER TABLE inventory_sheet_links DROP CONSTRAINT IF EXISTS inventory_sheet_links_link_type_check;
ALTER TABLE inventory_sheet_links
  ADD CONSTRAINT inventory_sheet_links_link_type_check CHECK (link_type IN ('inventory', 'fbm', 'fbm_accounting'));
