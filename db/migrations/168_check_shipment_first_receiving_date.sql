-- Ngày đến tự động: ngày đầu tiên báo cáo Check Shipment (crawler 16h10 hằng ngày) thấy lô chuyển sang
-- Receiving / Closed. Báo cáo Amazon không có cột ngày đến nên lấy mốc chuyển trạng thái này.
-- syncCheckShipmentsToInbound điền vào Ngày đến của Chi tiết đi hàng khi sheet để trống.

ALTER TABLE accounting_amazon_check_shipments
  ADD COLUMN IF NOT EXISTS first_receiving_date TEXT;

CREATE OR REPLACE FUNCTION accounting_check_shipment_first_receiving() RETURNS trigger AS $$
BEGIN
  -- Chỉ ghi khi thấy chuyển trạng thái thật (cập nhật từ trạng thái chưa nhận sang Receiving/Closed).
  -- Dòng tạo mới đã ở Receiving/Closed (nạp lại file cũ) không biết ngày nhận → để trống.
  IF NEW.first_receiving_date IS NULL
     AND LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('receiving', 'closed')
     AND LOWER(TRIM(COALESCE(OLD.status, ''))) NOT IN ('receiving', 'closed') THEN
    NEW.first_receiving_date := to_char(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_shipment_first_receiving ON accounting_amazon_check_shipments;
CREATE TRIGGER trg_check_shipment_first_receiving
  BEFORE UPDATE OF status ON accounting_amazon_check_shipments
  FOR EACH ROW EXECUTE FUNCTION accounting_check_shipment_first_receiving();

-- Lấp lại từ lịch sử thay đổi. Trước 25/10/2026 lịch sử nhiễu (nạp lại hàng loạt lô cũ 23–24/10) → bỏ qua.
UPDATE accounting_amazon_check_shipments c
SET first_receiving_date = f.d
FROM (
  SELECT h.entity_id, to_char(MIN(h.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS d
  FROM inventory_change_history h
  WHERE h.entity_type = 'check_shipment'
    AND h.action = 'update'
    AND h.created_at >= '2026-10-25'
    AND LOWER(TRIM(COALESCE(h.after_data->>'status', ''))) IN ('receiving', 'closed')
    AND LOWER(TRIM(COALESCE(h.before_data->>'status', ''))) NOT IN ('receiving', 'closed')
  GROUP BY h.entity_id
) f
WHERE c.id = f.entity_id
  AND c.first_receiving_date IS NULL;
