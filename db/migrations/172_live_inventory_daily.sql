-- 172_live_inventory_daily.sql
-- Lịch sử tồn kho từng ngày (tab TỒN → Theo ngày / chọn khoảng ngày, lib/accounting/inventory-range-db.ts).
-- accounting_live_inventory chỉ giữ ảnh chụp mới nhất; bảng này giữ 1 ảnh chụp / store / kho / ngày,
-- ghi cùng lúc crawler kế toán 16h10 nạp FBA Inventory (File 06) + AWD inventory report. Nạp lại trong ngày thì ghi đè ngày đó.
-- snapshot_date = ngày mà ảnh chụp là TỒN CUỐI NGÀY: crawler chạy ~16h giờ VN = ~1h sáng giờ Mỹ hôm sau
-- → ảnh nạp ngày D (giờ VN) là tồn cuối ngày D − 1 (giờ Mỹ, cùng múi với ngày đơn hàng).

CREATE TABLE IF NOT EXISTS accounting_live_inventory_daily (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('FBA', 'AWD')),
  snapshot_date DATE NOT NULL,
  sku TEXT NOT NULL,
  fnsku TEXT,
  asin TEXT,
  available INTEGER NOT NULL DEFAULT 0,
  inbound INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, source, snapshot_date, sku)
);

-- Ảnh chụp đang có → tồn cuối ngày trước ngày nạp (giờ VN)
INSERT INTO accounting_live_inventory_daily (store_id, source, snapshot_date, sku, fnsku, asin, available, inbound, reserved, imported_at)
SELECT store_id, source, (imported_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1, sku, fnsku, asin, available, inbound, reserved, imported_at
FROM accounting_live_inventory
ON CONFLICT DO NOTHING;
