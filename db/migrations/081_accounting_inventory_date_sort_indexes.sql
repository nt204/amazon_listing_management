-- 081_accounting_inventory_date_sort_indexes.sql
-- Tối ưu hóa hiệu năng sắp xếp theo Tháng listing mới nhất và Ngày đi từ mới nhất

CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_thang_listing_sort
  ON accounting_sku_master (store_id, thang_listing DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounting_inbound_shipments_ngay_di_sort
  ON accounting_inbound_shipments (store_id, ngay_di DESC NULLS LAST, created_at DESC);
