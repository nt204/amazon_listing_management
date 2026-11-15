-- 151_accounting_weekly_prepaid_stock.sql
-- Báo cáo tuần → bảng Tồn kho: 2 cột kế toán tự điền như sheet "BÁO CÁO TUẦN TỔNG HỢP" (cột hồng):
-- SL trả trước cho SUP và Giá trị trả trước ($), mỗi store × tuần (week_start = ngày đầu đoạn tuần).
-- Tổng tồn = tồn AMZ + trả trước; Số tuần bán hết = Tổng SL tồn ÷ Bán/tuần.

CREATE TABLE IF NOT EXISTS accounting_weekly_prepaid_stock (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  units INTEGER CHECK (units IS NULL OR units >= 0),
  value NUMERIC(14, 2) CHECK (value IS NULL OR value >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, week_start)
);
