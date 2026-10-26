-- db/migrations/103_accounting_orders_line_no.sql
-- Lưu thứ tự dòng trong file import để tái hiện XLOOKUP "dòng đầu tiên" của workbook
-- (RETURN lấy SKU + Basecost theo dòng order đầu tiên của cùng amazon-order-id).

ALTER TABLE accounting_orders ADD COLUMN IF NOT EXISTS line_no BIGINT;

-- Backfill dữ liệu cũ theo thứ tự vật lý lúc insert (đúng thứ tự file với các lần import snapshot).
UPDATE accounting_orders o
SET line_no = ranked.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY store_id ORDER BY ctid) AS rn
  FROM accounting_orders
) ranked
WHERE ranked.id = o.id AND o.line_no IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_orders_order_line
  ON accounting_orders(store_id, amazon_order_id, line_no);
