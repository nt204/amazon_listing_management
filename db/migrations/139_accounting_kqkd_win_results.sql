-- 139_accounting_kqkd_win_results.sql
-- Tab KQKD (file "BÁO CÁO KQKD SKU TESTING"): cột "Số SKU WIN KQ Thực tế" ở tab BÁO CÁO TỔNG QUAN THÁNG
-- là ô Team điền tay — không có công thức. Lưu đúng như vậy: mỗi (store, tháng đánh giá, phôi) một con số.
-- Mục tiêu WIN = 40% × số SKU đến hạn đánh giá, tỉ lệ WIN = WIN thực tế ÷ số SKU — tính ở lib/accounting/kqkd-db.ts.

CREATE TABLE IF NOT EXISTS accounting_kqkd_win_results (
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  eval_month TEXT NOT NULL CHECK (eval_month ~ '^[0-9]{4}-[0-9]{2}$'),
  product_type TEXT NOT NULL,
  win_count INTEGER NOT NULL CHECK (win_count >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, eval_month, product_type)
);
