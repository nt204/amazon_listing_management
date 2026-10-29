-- 125_accounting_dashboard_data_version_fbm.sql
-- Dashboard kế toán giờ tính cả kênh FBM (listFbmDaily / LỌC SKU CỐ ĐỊNH FBM), đọc thêm BẢNG MÃ FBM
-- và ĐẦU VÀO FBM PW: các bảng này cũng phải tăng phiên bản dữ liệu (xem 123) để cache Dashboard tính lại.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_sku_master_fbm',
    'accounting_fbm_pw_costs'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_dashboard_version ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_dashboard_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I '
      'FOR EACH STATEMENT EXECUTE FUNCTION accounting_bump_dashboard_data_version()',
      t, t
    );
  END LOOP;
END;
$$;
