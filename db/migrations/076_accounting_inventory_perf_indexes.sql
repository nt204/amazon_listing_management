-- 076_accounting_inventory_perf_indexes.sql
-- Performance indexes for large-scale Inventory SKU Master & Inbound Shipments

CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_store_perf
  ON accounting_sku_master (store_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_store_status_type
  ON accounting_sku_master (store_id, status, product_type);

CREATE INDEX IF NOT EXISTS idx_accounting_inbound_store_perf
  ON accounting_inbound_shipments (store_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_accounting_inbound_store_status
  ON accounting_inbound_shipments (store_id, status);
