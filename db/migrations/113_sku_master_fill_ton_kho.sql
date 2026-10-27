-- 113_sku_master_fill_ton_kho.sql
-- SKU mới thêm vào BẢNG MÃ (đồng bộ Sheet, nhập Excel, Thêm Phôi) hoặc vừa khôi phục thì lấy luôn cột Tồn
-- từ báo cáo mới nhất đã nạp, không chờ lần nạp Inventory Ledger tuần sau.
-- Cùng công thức với lúc nạp ledger: Tồn = Tồn FBA (In Transit + Ending) + Tồn AWD.
-- Mỗi SKU chỉ lấy snapshot mới nhất của store, gộp các dòng US/CA/disposition 1 lần (không cộng trùng).

CREATE INDEX IF NOT EXISTS idx_acc_inv_ledger_store_date_sku
  ON accounting_inventory_ledger (store_id, snapshot_date, UPPER(TRIM(sku)));
CREATE INDEX IF NOT EXISTS idx_acc_awd_ledger_store_date_sku
  ON accounting_awd_inventory_ledger (store_id, snapshot_date, UPPER(TRIM(sku)));

CREATE OR REPLACE FUNCTION accounting_sku_master_fill_ton_kho() RETURNS trigger AS $$
DECLARE
  fba_date DATE;
  awd_date DATE;
  v_in_transit NUMERIC;
  v_ending NUMERIC;
  v_awd NUMERIC;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- UPDATE chỉ xử lý khi khôi phục dòng đã xóa mềm (số tồn của dòng đó có thể đã cũ)
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT MAX(snapshot_date) INTO fba_date FROM accounting_inventory_ledger WHERE store_id = NEW.store_id;
  IF fba_date IS NOT NULL THEN
    SELECT COALESCE(SUM(in_transit_between_warehouses), 0), COALESCE(SUM(ending_warehouse_balance), 0)
      INTO v_in_transit, v_ending
      FROM accounting_inventory_ledger
     WHERE store_id = NEW.store_id AND snapshot_date = fba_date AND UPPER(TRIM(sku)) = UPPER(TRIM(NEW.sku));
    NEW.in_transit_between_warehouses := v_in_transit;
    NEW.ending_warehouse_balance := v_ending;
    NEW.ton_kho_fba := v_in_transit + v_ending;
    NEW.ton_kho_fba_updated_at := NOW();
  END IF;

  SELECT MAX(snapshot_date) INTO awd_date FROM accounting_awd_inventory_ledger WHERE store_id = NEW.store_id;
  IF awd_date IS NOT NULL THEN
    SELECT COALESCE(SUM(ton_kho_units), 0)
      INTO v_awd
      FROM accounting_awd_inventory_ledger
     WHERE store_id = NEW.store_id AND snapshot_date = awd_date AND UPPER(TRIM(sku)) = UPPER(TRIM(NEW.sku));
    NEW.ton_kho_awd := v_awd;
    NEW.ton_kho_awd_updated_at := NOW();
  END IF;

  -- Store chưa từng nạp báo cáo nào thì để trống (hiện "—")
  IF fba_date IS NOT NULL OR awd_date IS NOT NULL THEN
    NEW.ton_kho := COALESCE(NEW.ton_kho_fba, 0) + COALESCE(NEW.ton_kho_awd, 0);
    NEW.ton_kho_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_sku_master_fill_ton_kho ON accounting_sku_master;
CREATE TRIGGER trg_accounting_sku_master_fill_ton_kho
  BEFORE INSERT OR UPDATE OF deleted_at ON accounting_sku_master
  FOR EACH ROW EXECUTE FUNCTION accounting_sku_master_fill_ton_kho();
