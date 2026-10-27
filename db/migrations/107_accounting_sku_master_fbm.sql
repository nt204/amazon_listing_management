-- 107_accounting_sku_master_fbm.sql
-- BẢNG MÃ FBM: bảng mã riêng cho các store có team FBM. Cùng cấu trúc với BẢNG MÃ (FBA)
-- nhưng tách bảng để Dashboard / PPC / Basecost (đọc accounting_sku_master) không bị lẫn dữ liệu FBM.

CREATE TABLE IF NOT EXISTS accounting_sku_master_fbm (
  LIKE accounting_sku_master INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);

-- Các cột riêng theo mẫu sheet "FBM_<Store>" (SUP, Size, Basecost + phí ship, Ngày lên camp...).
-- "Amazon FBA Fee" dùng cột amazon_fee, "Ngày Listing" dùng thang_listing, "Ngách" dùng niche.
ALTER TABLE accounting_sku_master_fbm
  ADD COLUMN IF NOT EXISTS sup TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS basecost NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS add_shipping_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS ngay_len_camp TEXT,
  ADD COLUMN IF NOT EXISTS phan_loai_kich_thuoc TEXT;

-- Total = Basecost + Shipping fee + Add shipping fee (như công thức =SUM trong sheet).
ALTER TABLE accounting_sku_master_fbm
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10, 2) GENERATED ALWAYS AS (
    CASE
      WHEN basecost IS NULL AND shipping_fee IS NULL AND add_shipping_fee IS NULL THEN NULL
      ELSE COALESCE(basecost, 0) + COALESCE(shipping_fee, 0) + COALESCE(add_shipping_fee, 0)
    END
  ) STORED;

ALTER TABLE accounting_sku_master_fbm
  DROP CONSTRAINT IF EXISTS accounting_sku_master_fbm_store_id_fkey;
ALTER TABLE accounting_sku_master_fbm
  ADD CONSTRAINT accounting_sku_master_fbm_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE inventory_change_history DROP CONSTRAINT IF EXISTS inventory_change_history_entity_type_check;
ALTER TABLE inventory_change_history ADD CONSTRAINT inventory_change_history_entity_type_check
  CHECK (entity_type IN ('sku', 'sku_fbm', 'inbound', 'check_shipment', 'monthly_base_cost'));

DROP TRIGGER IF EXISTS trg_accounting_sku_fbm_history ON accounting_sku_master_fbm;
CREATE TRIGGER trg_accounting_sku_fbm_history
AFTER INSERT OR UPDATE ON accounting_sku_master_fbm
FOR EACH ROW EXECUTE FUNCTION record_inventory_change('sku_fbm');
