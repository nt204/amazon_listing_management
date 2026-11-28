-- 177_sku_master_source.sql
-- Nguồn tạo dòng BẢNG MÃ FBA. 'trello' = tạo từ thẻ Trello (kéo vào cột ĐI HÀNG FBA):
-- đồng bộ Google Sheet KHÔNG ghi đè và KHÔNG xoá mềm các dòng này (web là bản gốc của SKU đó).
-- NULL = dòng theo sheet như trước.
ALTER TABLE accounting_sku_master ADD COLUMN IF NOT EXISTS source TEXT;
