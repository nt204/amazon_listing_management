-- 176_inbound_shipments_created_by.sql
-- Người tạo dòng CHI TIẾT ĐI HÀNG từ web Fulfill (New Shipment Request): id tài khoản đăng nhập + tên hiển thị lúc tạo.
-- Thời gian tạo dùng cột created_at sẵn có. Dòng cũ (đồng bộ sheet / import) để NULL.
ALTER TABLE accounting_inbound_shipments ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
ALTER TABLE accounting_inbound_shipments ADD COLUMN IF NOT EXISTS created_by_name TEXT;
