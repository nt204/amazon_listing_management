-- ppc_performance_facts nằm trên đĩa VPS 38 GB đã gần đầy (2026-11-07). Ba index dưới đây có idx_scan = 0 và
-- last_idx_scan NULL từ khi Postgres khởi động (2026-10-02 → 2026-11-07): planner luôn chọn index khác
-- (identity_unique / scope / target). Bỏ đi trả ngay ≈ 1,8 GB cho hệ điều hành; không đổi kết quả truy vấn nào.
-- ppc_performance_campaign_idx giữ lại vì vẫn có lượt dùng.
-- lock_timeout: nếu bảng đang bị giữ (worker đang nạp) thì migration lỗi ngay, deploy dừng, app không bị khoá.
SET LOCAL lock_timeout = '10s';
DROP INDEX IF EXISTS ppc_performance_active_idx;
DROP INDEX IF EXISTS ppc_performance_negative_idx;
DROP INDEX IF EXISTS ppc_performance_sku_campaign_idx;
