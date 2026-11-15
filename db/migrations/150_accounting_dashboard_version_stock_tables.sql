-- 150_accounting_dashboard_version_stock_tables.sql
-- Tồn / Giá trị tồn của Dashboard (lib/accounting/dashboard-stock.ts) đọc Inventory Ledger, AWD Ledger và
-- Inbound Shipments. Trước đây các bảng này không tăng phiên bản dữ liệu nên cache tồn phải tự hết hạn mỗi 5 phút
-- (mỗi lần mở Dashboard sau 15 phút lại tính lại 7 store). Thêm trigger như migration 123 → cache tồn chỉ tính lại
-- khi dữ liệu thật sự đổi. FOR EACH STATEMENT: nạp hàng loạt chỉ tăng 1 lần mỗi câu lệnh.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_inventory_ledger',
    'accounting_awd_inventory_ledger',
    'accounting_inbound_shipments'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_dashboard_version ON %I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_%s_dashboard_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I '
        'FOR EACH STATEMENT EXECUTE FUNCTION accounting_bump_dashboard_data_version()',
        t, t
      );
    END IF;
  END LOOP;
END;
$$;
