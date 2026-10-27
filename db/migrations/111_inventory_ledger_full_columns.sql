-- 111_inventory_ledger_full_columns.sql
-- Tab TỒN KHO hiển thị đủ các cột của báo cáo Inventory Ledger (Summary) và tách theo Location
-- (cùng SKU có thể có dòng US và CA riêng).
ALTER TABLE accounting_inventory_ledger
  ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS starting_warehouse_balance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipts NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_shipments NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_returns NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor_returns NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_transfer_in_out NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS found NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disposed NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_events NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unknown_events NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE accounting_inventory_ledger DROP CONSTRAINT IF EXISTS uq_accounting_inventory_ledger_row;
ALTER TABLE accounting_inventory_ledger
  ADD CONSTRAINT uq_accounting_inventory_ledger_row UNIQUE (store_id, snapshot_date, sku, asin, fnsku, disposition, location);
