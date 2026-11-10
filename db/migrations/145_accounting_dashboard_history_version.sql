-- 145_accounting_dashboard_history_version.sql
-- "Phiên bản dữ liệu cũ" cho cache Dashboard kế toán theo tháng.
--
-- Phiên bản 123/125 tăng sau MỌI lệnh ghi (crawler ghi đơn/ads liên tục) nên cache Dashboard gần như luôn nguội.
-- Dashboard giờ cache số liệu theo từng tháng: các tháng gần đây (≤ 40 ngày) vẫn theo phiên bản 123 như cũ,
-- các tháng cũ hơn chỉ tính lại khi sequence dưới đây tăng. Sequence chỉ tăng khi một lệnh ghi THẬT SỰ đổi
-- dữ liệu ảnh hưởng tới số liệu cũ:
--   - orders / ads / returns: dòng có ngày cũ hơn 35 ngày (thêm, xoá, hoặc sửa khác giá trị);
--   - BẢNG MÃ FBA / FBM, stores: mọi thay đổi trừ cột tồn kho và mốc thời gian (đồng bộ tồn kho không làm nguội cache);
--   - Basecost tháng: kỳ cũ hơn 35 ngày;
--   - PW FBM: dòng thuộc đơn có ngày cũ hơn 35 ngày.
-- Ghi đè cùng giá trị (upsert của crawler) không tăng. Ngưỡng 35 ngày phải nhỏ hơn cửa sổ "tháng gần đây" trong code (40).
--
-- Trigger theo dòng có WHEN: Postgres lọc ngày ngay trong C nên ghi dữ liệu gần đây (việc thường ngày của crawler)
-- gần như không tốn thêm; hàm chỉ chạy cho dòng cũ. (Trigger theo câu lệnh + bảng transition chậm ~2,5 lần mọi lệnh ghi.)

CREATE SEQUENCE IF NOT EXISTS accounting_dashboard_history_version;
-- Gọi 1 lần để last_value bắt đầu thay đổi ngay từ lần tăng đầu tiên (sequence mới có is_called = false).
SELECT nextval('accounting_dashboard_history_version');

-- Bỏ các cột không ảnh hưởng số liệu Dashboard trước khi so sánh dòng cũ / mới.
CREATE OR REPLACE FUNCTION accounting_dashboard_history_strip(j jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT j - ARRAY[
    'updated_at', 'created_at', 'synced_at', 'last_changed_by',
    'ton_kho', 'ton_kho_updated_at', 'ton_kho_fba', 'ton_kho_fba_updated_at', 'ton_kho_awd', 'ton_kho_awd_updated_at',
    'in_transit_between_warehouses', 'ending_warehouse_balance'
  ]
$$;

-- TG_ARGV[0] = 'pw': chỉ tính khi dòng PW thuộc đơn có ngày cũ (bảng PW không có cột ngày).
CREATE OR REPLACE FUNCTION accounting_bump_dashboard_history_version() RETURNS trigger AS $$
DECLARE
  r_new jsonb;
  r_old jsonb;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    PERFORM nextval('accounting_dashboard_history_version');
    RETURN NULL;
  END IF;
  IF TG_OP <> 'DELETE' THEN r_new := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN r_old := to_jsonb(OLD); END IF;

  -- Ghi đè cùng giá trị (chỉ đổi tồn kho / mốc thời gian) → bỏ qua
  IF TG_OP = 'UPDATE'
     AND accounting_dashboard_history_strip(r_new) = accounting_dashboard_history_strip(r_old) THEN
    RETURN NULL;
  END IF;

  IF TG_ARGV[0] = 'pw' AND NOT EXISTS (
    SELECT 1 FROM accounting_orders ao
    WHERE ao.date < CURRENT_DATE - 35
      AND (
        (ao.store_id = (r_new->>'store_id')::uuid AND ao.amazon_order_id = r_new->>'order_id')
        OR (ao.store_id = (r_old->>'store_id')::uuid AND ao.amazon_order_id = r_old->>'order_id')
      )
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM nextval('accounting_dashboard_history_version');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  spec TEXT[];
  t TEXT;
  kind TEXT;
  old_new TEXT;
  old_old TEXT;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['accounting_orders', 'date'],
    ARRAY['accounting_ads', 'date'],
    ARRAY['accounting_returns', 'date'],
    ARRAY['accounting_sku_master', 'all'],
    ARRAY['accounting_sku_master_fbm', 'all'],
    ARRAY['accounting_monthly_base_cost', 'period'],
    ARRAY['accounting_fbm_pw_costs', 'pw'],
    ARRAY['stores', 'all']
  ] LOOP
    t := spec[1];
    kind := spec[2];
    -- Điều kiện "dòng cũ" cho WHEN (NULL = không lọc)
    old_new := CASE kind
      WHEN 'date' THEN 'NEW.date < CURRENT_DATE - 35'
      WHEN 'period' THEN 'NEW.period <= to_char(CURRENT_DATE - 35, ''YYYY-MM'')'
    END;
    old_old := replace(old_new, 'NEW.', 'OLD.');

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_dash_hist_ins ON %I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_dash_hist_upd ON %I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_dash_hist_del ON %I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_dash_hist_trunc ON %I', t, t);

    EXECUTE format(
      'CREATE TRIGGER trg_%s_dash_hist_ins AFTER INSERT ON %I FOR EACH ROW %s '
      'EXECUTE FUNCTION accounting_bump_dashboard_history_version(%L)',
      t, t, CASE WHEN old_new IS NULL THEN '' ELSE format('WHEN (%s)', old_new) END, kind);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_dash_hist_upd AFTER UPDATE ON %I FOR EACH ROW %s '
      'EXECUTE FUNCTION accounting_bump_dashboard_history_version(%L)',
      t, t, CASE WHEN old_new IS NULL THEN '' ELSE format('WHEN (%s OR %s)', old_new, old_old) END, kind);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_dash_hist_del AFTER DELETE ON %I FOR EACH ROW %s '
      'EXECUTE FUNCTION accounting_bump_dashboard_history_version(%L)',
      t, t, CASE WHEN old_old IS NULL THEN '' ELSE format('WHEN (%s)', old_old) END, kind);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_dash_hist_trunc AFTER TRUNCATE ON %I '
      'FOR EACH STATEMENT EXECUTE FUNCTION accounting_bump_dashboard_history_version(%L)', t, t, kind);
  END LOOP;
END;
$$;
