-- 123_accounting_dashboard_data_version.sql
-- "Phiên bản dữ liệu" cho cache Dashboard kế toán: mọi lệnh ghi vào các bảng Dashboard đọc
-- (orders, ads, returns, BẢNG MÃ, basecost tháng, stores) đều tăng sequence này, kể cả sửa ô,
-- crawler, đồng bộ Sheet. Key cache chứa phiên bản nên dữ liệu sửa xong là Dashboard tính lại ngay.
-- Dùng sequence (không khóa dòng) để không chặn các lệnh ghi song song; trigger FOR EACH STATEMENT
-- nên nhập hàng loạt chỉ tăng 1 lần mỗi câu lệnh.

CREATE SEQUENCE IF NOT EXISTS accounting_dashboard_data_version;

CREATE OR REPLACE FUNCTION accounting_bump_dashboard_data_version() RETURNS trigger AS $$
BEGIN
  PERFORM nextval('accounting_dashboard_data_version');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_orders',
    'accounting_ads',
    'accounting_returns',
    'accounting_sku_master',
    'accounting_monthly_base_cost',
    'stores'
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
