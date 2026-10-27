-- 109_accounting_inventory_ledger.sql
-- Bảng lưu chi tiết từng dòng báo cáo Inventory Ledger (LEDGER_REPORT) từ Amazon Seller Central
CREATE TABLE IF NOT EXISTS accounting_inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    report_date DATE,
    fnsku TEXT,
    asin TEXT NOT NULL,
    sku TEXT NOT NULL,
    title TEXT,
    disposition TEXT,
    in_transit_between_warehouses NUMERIC NOT NULL DEFAULT 0,
    ending_warehouse_balance NUMERIC NOT NULL DEFAULT 0,
    total_warehouse_balance NUMERIC NOT NULL DEFAULT 0,
    source_file TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_accounting_inventory_ledger_row UNIQUE (store_id, snapshot_date, sku, asin, fnsku, disposition)
);

CREATE INDEX IF NOT EXISTS idx_acc_inv_ledger_store_date ON accounting_inventory_ledger(store_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_acc_inv_ledger_sku_asin ON accounting_inventory_ledger(store_id, sku, asin);

-- Bảng lưu tổng hợp tồn kho mới nhất theo từng Store + SKU + ASIN
CREATE TABLE IF NOT EXISTS accounting_inventory_balance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    asin TEXT NOT NULL,
    fnsku TEXT,
    title TEXT,
    in_transit_between_warehouses NUMERIC NOT NULL DEFAULT 0,
    ending_warehouse_balance NUMERIC NOT NULL DEFAULT 0,
    ton_kho NUMERIC NOT NULL DEFAULT 0,
    sellable_balance NUMERIC NOT NULL DEFAULT 0,
    unsellable_balance NUMERIC NOT NULL DEFAULT 0,
    snapshot_date DATE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_accounting_inventory_balance UNIQUE (store_id, sku, asin)
);

CREATE INDEX IF NOT EXISTS idx_acc_inv_balance_store_sku ON accounting_inventory_balance(store_id, sku, asin);

-- Bổ sung cột ton_kho vào accounting_sku_master và accounting_sku_master_fbm
ALTER TABLE accounting_sku_master 
ADD COLUMN IF NOT EXISTS ton_kho NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS in_transit_between_warehouses NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ending_warehouse_balance NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ton_kho_updated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE accounting_sku_master_fbm 
ADD COLUMN IF NOT EXISTS ton_kho NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS in_transit_between_warehouses NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ending_warehouse_balance NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ton_kho_updated_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_store_sku_asin ON accounting_sku_master(store_id, sku, asin);
