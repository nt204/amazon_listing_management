-- 174_inbound_shipments_source.sql
-- Nguồn tạo dòng CHI TIẾT ĐI HÀNG. 'fulfill' = tạo từ web Đi hàng (yêu cầu đi hàng / xưởng điền):
-- đồng bộ Google Sheet vẫn ghi đè ô có giá trị nhưng KHÔNG xóa mềm các dòng này khi sheet chưa có.
-- NULL = dòng cũ (đồng bộ sheet, import file, nhập tay trên Kế toán).
ALTER TABLE accounting_inbound_shipments ADD COLUMN IF NOT EXISTS source TEXT;
