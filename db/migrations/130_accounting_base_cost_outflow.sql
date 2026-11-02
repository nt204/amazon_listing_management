-- 130_accounting_base_cost_outflow.sql
-- Base Cost tháng tính giống sheet "BASECOST THÁNG" (file <STORE> INVENTORY 2026):
--   Tồn đầu tháng  = Tồn cuối tháng trước = Tồn đầu tháng trước + Nhập tháng trước − Hàng ra kho tháng trước
--   Nhập trong tháng = SUM("Amazon Received") của CHI TIẾT ĐI HÀNG theo Ngày đến
--   Hàng ra kho    = sheet LƯỢNG BÁN: SL bán (không tính đơn Cancelled) − Return + Adjustment + Removal
-- sl_ra_kho do pipeline kế toán tháng (scripts/ingest_monthly_from_raw.py) ghi từ file thô Amazon.
-- NULL = tháng đó chưa có số liệu ra kho; store chưa có dòng nào có sl_ra_kho vẫn tính tồn theo báo cáo tồn kho như cũ.

ALTER TABLE accounting_monthly_base_cost
  ADD COLUMN IF NOT EXISTS sl_ra_kho NUMERIC(14, 4);

-- Nhập trong tháng giờ lấy theo amazon_received nên đổi số nhận cũng phải tính lại Base Cost
CREATE OR REPLACE FUNCTION accounting_inbound_enqueue_base_cost_resync() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (OLD.store_id, OLD.sku, OLD.quantity, OLD.amazon_received, OLD.total_basecost, OLD.final_basecost, OLD.ngay_den, OLD.deleted_at)
     IS NOT DISTINCT FROM
     (NEW.store_id, NEW.sku, NEW.quantity, NEW.amazon_received, NEW.total_basecost, NEW.final_basecost, NEW.ngay_den, NEW.deleted_at) THEN
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
