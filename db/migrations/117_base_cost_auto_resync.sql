-- 117_base_cost_auto_resync.sql
-- Base Cost tháng tự tính lại khi lô hàng ở CHI TIẾT ĐI HÀNG thay đổi (thêm/sửa/xóa, nhập Excel, đồng bộ Sheet, Check Shipment)
-- hoặc khi nạp báo cáo tồn kho FBA/AWD mới.
-- Trigger chỉ ghi "store X cần tính lại từ tháng Y" vào hàng đợi (mỗi store 1 dòng, giữ tháng sớm nhất);
-- worker trong server (lib/accounting/base-cost-resync.ts) chờ dữ liệu lắng xuống rồi mới tính, nên nhập hàng loạt chỉ tính 1 lần.

CREATE TABLE IF NOT EXISTS accounting_base_cost_resync_queue (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  from_period TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION accounting_enqueue_base_cost_resync(p_store_id UUID, p_period TEXT) RETURNS void AS $$
BEGIN
  IF p_store_id IS NULL OR p_period IS NULL OR p_period !~ '^\d{4}-\d{2}$' THEN
    RETURN;
  END IF;
  INSERT INTO accounting_base_cost_resync_queue (store_id, from_period, requested_at)
  VALUES (p_store_id, p_period, NOW())
  ON CONFLICT (store_id) DO UPDATE
  SET from_period = LEAST(accounting_base_cost_resync_queue.from_period, EXCLUDED.from_period),
      requested_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Tháng của ngay_den (chấp nhận cả 'YYYY-MM-DD' và 'YYYY/MM/DD', giống điều kiện lọc lúc tính Base Cost)
CREATE OR REPLACE FUNCTION accounting_inbound_arrival_period(p_ngay_den TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN REPLACE(LEFT(TRIM(p_ngay_den), 7), '/', '-') ~ '^\d{4}-\d{2}$'
      THEN REPLACE(LEFT(TRIM(p_ngay_den), 7), '/', '-')
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION accounting_inbound_enqueue_base_cost_resync() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (OLD.store_id, OLD.sku, OLD.quantity, OLD.total_basecost, OLD.final_basecost, OLD.ngay_den, OLD.deleted_at)
     IS NOT DISTINCT FROM
     (NEW.store_id, NEW.sku, NEW.quantity, NEW.total_basecost, NEW.final_basecost, NEW.ngay_den, NEW.deleted_at) THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM accounting_enqueue_base_cost_resync(OLD.store_id, accounting_inbound_arrival_period(OLD.ngay_den));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM accounting_enqueue_base_cost_resync(NEW.store_id, accounting_inbound_arrival_period(NEW.ngay_den));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_inbound_enqueue_base_cost_resync ON accounting_inbound_shipments;
CREATE TRIGGER trg_accounting_inbound_enqueue_base_cost_resync
  AFTER INSERT OR UPDATE OR DELETE ON accounting_inbound_shipments
  FOR EACH ROW EXECUTE FUNCTION accounting_inbound_enqueue_base_cost_resync();
