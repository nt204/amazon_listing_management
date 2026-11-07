-- Giá tồn đầu năm của từng SKU = cột "Trung bình giá 1/1/<năm>" ở tab TỒN của file "<STORE> INVENTORY <năm>".
-- Giá trị tồn dùng giá này khi SKU không có lô nào trong CHI TIẾT ĐI HÀNG (giống công thức
-- BASECOST TB/NĂM = IF(SL đi hàng <= 0, Trung bình giá 1/1, Tiền hàng / SL đi hàng) trên sheet).
-- Thêm cho cả bảng FBM để câu truy vấn Bảng Mã dùng chung cho hai kênh không lỗi cột.
ALTER TABLE accounting_sku_master ADD COLUMN IF NOT EXISTS gia_ton_dau_nam NUMERIC(14, 6);
ALTER TABLE accounting_sku_master_fbm ADD COLUMN IF NOT EXISTS gia_ton_dau_nam NUMERIC(14, 6);
