-- 160_accounting_live_inventory.sql
-- Tồn kho "real time" từng SKU, nạp mỗi ngày cùng lượt crawler kế toán 16h10 (lib/accounting/live-inventory.ts):
--   FBA: báo cáo FBA Inventory (reportcentral/MANAGE_INVENTORY_HEALTH) = File 06 của crawler kế toán;
--   AWD: AWD Reports → "AWD inventory report" trên trang fba-inventory/gim/inventory-list.
-- Tồn mỗi kho = available + inbound + reserved; tồn SKU = FBA + AWD.
-- Chỉ giữ ảnh chụp MỚI NHẤT của mỗi (store, kho): mỗi lần nạp thay toàn bộ dòng của kho đó.

CREATE TABLE IF NOT EXISTS accounting_live_inventory (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('FBA', 'AWD')),
  sku TEXT NOT NULL,
  fnsku TEXT,
  asin TEXT,
  available INTEGER NOT NULL DEFAULT 0,
  inbound INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  total INTEGER GENERATED ALWAYS AS (available + inbound + reserved) STORED,
  -- Ngày/giờ Amazon ghi trong file (FBA: snapshot-date; AWD: dòng "Timestamp"), giữ nguyên chữ để đối chiếu.
  report_label TEXT,
  file_name TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, source, sku)
);
