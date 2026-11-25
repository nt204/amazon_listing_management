-- 169_inventory_ton_tab.sql
-- Tab TỒN của Inventory (giống tab "TỒN" file <STORE> INVENTORY 2026 — lib/accounting/inventory-ton-db.ts):
--   estimated_storage_cost: cột "estimated-storage-cost-next-month" của báo cáo FBA Inventory (File 06, crawler 16h10)
--   ton_basecost: cột "BASECOST" nhập tay của tab TỒN (đồng bộ từ sheet, ô trống giữ số cũ)

ALTER TABLE accounting_live_inventory
  ADD COLUMN IF NOT EXISTS estimated_storage_cost NUMERIC(14, 4);

ALTER TABLE accounting_sku_master
  ADD COLUMN IF NOT EXISTS ton_basecost NUMERIC(14, 6);
