-- 175_fulfill_sup_accounts.sql
-- Tài khoản xưởng (sup) xem yêu cầu đi hàng ở trang /sup — CHỈ ĐỌC.
--
-- An toàn nhiều lớp:
--   1. Tài khoản xưởng KHÔNG phải user nội bộ (app_users): mọi API nội bộ tự từ chối.
--   2. Trang /sup chỉ có API GET; dữ liệu đọc trong transaction READ ONLY với SET LOCAL ROLE fulfill_sup_reader.
--   3. fulfill_sup_reader chỉ có quyền SELECT trên view fulfill_sup_lines — không đọc được bảng nào khác,
--      không ghi được gì (kể cả khi code có lỗi / bị SQL injection).
--   4. Tên xưởng lấy từ tài khoản phía server (sup_names), không lấy từ tham số người dùng gửi lên.

CREATE TABLE IF NOT EXISTS fulfill_sup_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT,
  -- Các tên Sup trong CHI TIẾT ĐI HÀNG mà tài khoản được xem (VD: {"Bác Kim Anh","bác Kim Anh 3D pop up"})
  sup_names TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fulfill_sup_accounts_email ON fulfill_sup_accounts (lower(btrim(email)));

CREATE TABLE IF NOT EXISTS fulfill_sup_access_log (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES fulfill_sup_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fulfill_sup_access_log_account ON fulfill_sup_access_log (account_id, at DESC);

-- Dòng CHI TIẾT ĐI HÀNG kèm thông tin Bảng Mã và Check Shipment — cùng cột với lib/fulfill/lots-db.ts loadRows.
CREATE OR REPLACE VIEW fulfill_sup_lines AS
WITH cs AS (
  SELECT DISTINCT ON (store_id, upper(btrim(shipment_id)))
    store_id, upper(btrim(shipment_id)) AS sid, status, units_expected, units_located
  FROM accounting_amazon_check_shipments
  WHERE deleted_at IS NULL
  ORDER BY store_id, upper(btrim(shipment_id)), updated_at DESC
)
SELECT
  i.id, i.store_id, st.name AS store_name, i.row_order, i.updated_at::text AS updated_at,
  i.brand, i.sup, i.ngay_request, i.product_type, i.mockup, i.sku, i.quantity, i.line_ship,
  i.base_cost_per_unit::float AS base_cost_per_unit, i.card::float AS card, i.tag::float AS tag,
  i.shipping_fee::float AS shipping_fee, i.hop_tui::float AS hop_tui,
  i.final_basecost::float AS final_basecost, i.total_basecost::float AS total_basecost,
  i.ten_lo_hang, i.shipment_id, i.ngay_di, i.ngay_den, i.status, i.amazon_received, i.so_luong_amazon_nhan,
  i.ngay_thanh_toan, i.note, i.trang_thai, i.custom_fields, i.source,
  sm.kich_thuoc, sm.file_design, sm.fnsku, sm.mockup_url AS sku_mockup,
  cs.sid AS cs_shipment, cs.status AS cs_status, cs.units_expected, cs.units_located,
  i.created_at
FROM accounting_inbound_shipments i
JOIN stores st ON st.id = i.store_id
LEFT JOIN accounting_sku_master sm
  ON sm.store_id = i.store_id AND sm.sku = i.sku AND sm.deleted_at IS NULL
LEFT JOIN cs ON cs.store_id = i.store_id AND cs.sid = upper(btrim(i.shipment_id))
WHERE i.deleted_at IS NULL
  AND NULLIF(btrim(i.sup), '') IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fulfill_sup_reader') THEN
    CREATE ROLE fulfill_sup_reader NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON fulfill_sup_lines FROM PUBLIC;
GRANT SELECT ON fulfill_sup_lines TO fulfill_sup_reader;
-- App user được SET ROLE sang fulfill_sup_reader (chỉ để hạ quyền)
GRANT fulfill_sup_reader TO CURRENT_USER;
