-- 159_accounting_shipment_discrepancies.sql
-- Bảng lưu trữ vĩnh viễn kết quả đối soát lệch kho FBA từ Seller Central (chống mất cache)

CREATE TABLE IF NOT EXISTS accounting_shipment_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  shipment_id TEXT NOT NULL,
  amazon_received INTEGER NOT NULL DEFAULT 0,
  so_luong_amazon_nhan INTEGER NOT NULL DEFAULT 0,
  discrepancy INTEGER NOT NULL DEFAULT 0,
  receiving_date TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shipment_discrepancies_item UNIQUE (store_name, shipment_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_shipment_discrepancies_store ON accounting_shipment_discrepancies(store_name);
CREATE INDEX IF NOT EXISTS idx_shipment_discrepancies_shipment ON accounting_shipment_discrepancies(shipment_id);

