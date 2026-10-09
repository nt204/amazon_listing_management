-- 078_accounting_inventory_custom_columns.sql
-- Support custom columns / dynamic metadata for SKU Master & Inbound Shipments

ALTER TABLE accounting_sku_master
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE accounting_inbound_shipments
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
