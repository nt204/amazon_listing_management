-- Số liệu THEO NGÀY kế toán đã chốt cho các năm trước khi hệ thống chạy (vd. 2025), nạp từ tab FBA / FBM của file
-- "<STORE> - KẾ TOÁN TỔNG HỢP <năm>" (scripts/import-daily-history-2025.ts).
-- Dashboard (dashboard-db fetchStoreDaily): ngày nào có dòng ở đây thì dùng số đã chốt thay cho số tự tính từ đơn,
-- để so sánh "vs Năm trước" khớp đúng sổ kế toán (năm 2025 áp thuế / phí khác 2026). Chi phí lưu số dương.
CREATE TABLE IF NOT EXISTS accounting_daily_history (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('FBA', 'FBM')),
  date DATE NOT NULL,
  revenue NUMERIC(14, 4) NOT NULL DEFAULT 0,
  quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
  ads_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost NUMERIC(14, 4) NOT NULL DEFAULT 0,
  amazon_fee NUMERIC(14, 4) NOT NULL DEFAULT 0,
  tax NUMERIC(14, 4) NOT NULL DEFAULT 0,
  promotion NUMERIC(14, 4) NOT NULL DEFAULT 0,
  refund NUMERIC(14, 4) NOT NULL DEFAULT 0,
  profit NUMERIC(14, 4) NOT NULL DEFAULT 0,
  source TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, channel, date)
);
