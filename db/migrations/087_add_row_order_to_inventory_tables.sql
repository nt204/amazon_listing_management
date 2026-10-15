-- 087_add_row_order_to_inventory_tables.sql
-- Add row_order column to inventory tables for consistent ordering and history restoration

ALTER TABLE accounting_sku_master ADD COLUMN IF NOT EXISTS row_order INTEGER DEFAULT 0;
ALTER TABLE accounting_inbound_shipments ADD COLUMN IF NOT EXISTS row_order INTEGER DEFAULT 0;
ALTER TABLE accounting_amazon_check_shipments ADD COLUMN IF NOT EXISTS row_order INTEGER DEFAULT 0;
