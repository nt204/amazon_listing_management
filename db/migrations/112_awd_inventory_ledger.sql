-- 112_awd_inventory_ledger.sql
-- Thêm các cột theo dõi riêng biệt tồn kho FBA, tồn kho AWD và tổng tồn kho vào accounting_sku_master
-- và bảng lưu trữ chi tiết báo cáo AWD Inventory Ledger.

ALTER TABLE accounting_sku_master
  ADD COLUMN IF NOT EXISTS ton_kho_fba NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ton_kho_awd NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ton_kho_fba_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ton_kho_awd_updated_at TIMESTAMPTZ;

-- Khởi tạo ban đầu: ton_kho_fba = ton_kho hiện tại nếu ton_kho_fba = 0
UPDATE accounting_sku_master
SET ton_kho_fba = COALESCE(ton_kho, 0)
WHERE ton_kho_fba = 0 AND ton_kho IS NOT NULL;

-- Bảng lưu trữ chi tiết từng dòng báo cáo AWD Inventory Ledger (Summary)
CREATE TABLE IF NOT EXISTS accounting_awd_inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  report_date DATE,
  sku TEXT NOT NULL,
  fnsku TEXT,
  asin TEXT NOT NULL,
  package_quantity NUMERIC NOT NULL DEFAULT 1,
  purchase_order_id TEXT,
  title TEXT,
  starting_warehouse_balance_cartons NUMERIC NOT NULL DEFAULT 0,
  received_cartons NUMERIC NOT NULL DEFAULT 0,
  departed_cartons NUMERIC NOT NULL DEFAULT 0,
  lost_cartons NUMERIC NOT NULL DEFAULT 0,
  found_cartons NUMERIC NOT NULL DEFAULT 0,
  other_cartons NUMERIC NOT NULL DEFAULT 0,
  unknown_cartons NUMERIC NOT NULL DEFAULT 0,
  ending_warehouse_balance_cartons NUMERIC NOT NULL DEFAULT 0,
  ton_kho_units NUMERIC NOT NULL DEFAULT 0,
  facility_id TEXT,
  country TEXT,
  expiry_date TEXT,
  source_file TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_awd_ledger_store_date 
  ON accounting_awd_inventory_ledger(store_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_accounting_awd_ledger_sku_asin 
  ON accounting_awd_inventory_ledger(store_id, sku, asin);
