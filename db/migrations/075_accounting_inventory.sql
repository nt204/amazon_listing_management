-- 075_accounting_inventory.sql
-- Accounting module: Inventory Management (SKU Master & Inbound Shipments) per Store

CREATE TABLE IF NOT EXISTS accounting_sku_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  brand TEXT,
  product_type TEXT,
  mockup TEXT,
  sku TEXT NOT NULL,
  asin TEXT,
  fnsku TEXT,
  amazon_fee NUMERIC(10, 2),
  referral_fee_pct NUMERIC(6, 4),
  pic_mkt TEXT,
  loai TEXT,
  niche TEXT,
  pic_idea TEXT,
  status TEXT DEFAULT 'Active',
  event TEXT,
  tinh_trang TEXT,
  design_pic TEXT,
  mockup_url TEXT,
  thang_listing TEXT,
  thang_danh_gia TEXT,
  event_250th TEXT,
  ngay_danh_gia_sku_event TEXT,
  amazon_fba_fee_thay_doi NUMERIC(10, 2),
  basecost_tb NUMERIC(10, 2),
  brand_entity_id TEXT,
  creative_asins_video TEXT,
  creative_asins_collection TEXT,
  video_media_ids TEXT,
  creative_headline TEXT,
  brand_logo_asset_id TEXT,
  landing_page_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_sku_master_store_sku UNIQUE (store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_store ON accounting_sku_master(store_id);
CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_sku ON accounting_sku_master(sku);
CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_asin ON accounting_sku_master(asin);

CREATE TABLE IF NOT EXISTS accounting_inbound_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES accounting_sku_master(id) ON DELETE SET NULL,
  brand TEXT,
  sup TEXT,
  ngay_request TEXT,
  product_type TEXT,
  mockup TEXT,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  line_ship TEXT,
  base_cost_per_unit NUMERIC(10, 2),
  card NUMERIC(10, 2),
  tag NUMERIC(10, 2),
  shipping_fee NUMERIC(10, 2),
  hop_tui NUMERIC(10, 2),
  final_basecost NUMERIC(10, 2),
  total_basecost NUMERIC(12, 2),
  ngay_thanh_toan TEXT,
  ten_lo_hang TEXT,
  shipment_id TEXT,
  ngay_di TEXT,
  ngay_den TEXT,
  amazon_received INTEGER,
  tinh_trang_hang_den_kho TEXT,
  status TEXT,
  so_luong_amazon_nhan INTEGER,
  discrepancy INTEGER,
  note TEXT,
  trang_thai TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_inbound_store ON accounting_inbound_shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_accounting_inbound_sku ON accounting_inbound_shipments(sku);
CREATE INDEX IF NOT EXISTS idx_accounting_inbound_shipment_id ON accounting_inbound_shipments(shipment_id);
