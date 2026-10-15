-- db/migrations/092_accounting_orders_order_item_id.sql
-- Thêm cột order_item_id và cập nhật ràng buộc UNIQUE để hỗ trợ đơn hàng có nhiều item / line item

ALTER TABLE accounting_orders ADD COLUMN IF NOT EXISTS order_item_id TEXT DEFAULT '';

-- Cập nhật các bản ghi null sang chuỗi rỗng
UPDATE accounting_orders SET order_item_id = '' WHERE order_item_id IS NULL;

-- Xóa ràng buộc cũ (store_id, amazon_order_id, sku)
ALTER TABLE accounting_orders DROP CONSTRAINT IF EXISTS uq_accounting_orders_store_order_sku;

-- Thêm ràng buộc UNIQUE mới bao gồm cả order_item_id
ALTER TABLE accounting_orders ADD CONSTRAINT uq_accounting_orders_store_order_item UNIQUE (store_id, amazon_order_id, sku, order_item_id);

-- Thêm chỉ mục tìm kiếm theo order_item_id
CREATE INDEX IF NOT EXISTS idx_accounting_orders_item_id ON accounting_orders(store_id, order_item_id);
