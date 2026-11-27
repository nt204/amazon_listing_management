-- 173_fulfill_production_orders.sql
-- Quản lý đơn đặt sản xuất hàng FBA gửi cho xưởng (Fulfill POs & Suppliers)

-- 1. Danh sách Nhà xưởng / Supplier
CREATE TABLE IF NOT EXISTS fulfill_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Đơn đặt sản xuất (PO - Production Order)
CREATE TABLE IF NOT EXISTS fulfill_pos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES fulfill_suppliers(id) ON DELETE RESTRICT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, pending_sup, producing, shipped, received, cancelled
  total_quantity INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fulfill_pos_store ON fulfill_pos(store_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_pos_supplier ON fulfill_pos(supplier_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_pos_order_date ON fulfill_pos(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_fulfill_pos_status ON fulfill_pos(status);

-- 3. Chi tiết từng dòng sản phẩm trong đợt hàng (PO Lines)
CREATE TABLE IF NOT EXISTS fulfill_po_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES fulfill_pos(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL DEFAULT 0,
  
  -- Nhóm 1: Bên mình điền
  product_type TEXT,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  line_ship TEXT,
  dimensions TEXT,
  basecost NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_card NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_tag NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_stand NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_box NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_line_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  design_url TEXT,
  card_url TEXT,
  tag_url TEXT,
  box_url TEXT,
  
  -- Nhóm 2: Đóng gói FBA
  transparency_code TEXT,
  fnsku TEXT,
  label_fnsku TEXT,
  shipment_id TEXT,
  box_quantity INTEGER,
  shipping_label TEXT,
  shipping_address TEXT,
  
  -- Nhóm 3: Theo dõi xưởng & vận chuyển
  shipping_out_date DATE,
  arrival_date DATE,
  replacement_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  sample_url TEXT,
  package_url TEXT,
  check_status TEXT, -- pending, ok, defect, replaced
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fulfill_po_lines_po ON fulfill_po_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_po_lines_sku ON fulfill_po_lines(sku);
CREATE INDEX IF NOT EXISTS idx_fulfill_po_lines_shipment ON fulfill_po_lines(shipment_id);

-- 4. Bảng SKU Master cho Fulfill (Lưu thông tin cố định như tab TỔNG HỢP SKU)
CREATE TABLE IF NOT EXISTS fulfill_sku_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  asin TEXT,
  fnsku TEXT,
  transparency_code TEXT,
  product_name TEXT,
  dimensions TEXT,
  pcs_per_box INTEGER NOT NULL DEFAULT 1,
  design_url TEXT,
  card_url TEXT,
  tag_url TEXT,
  box_url TEXT,
  basecost NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_card NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_tag NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_stand NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_box NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_fulfill_sku_master_store_sku ON fulfill_sku_master(store_id, sku);

-- 5. Nạp sẵn nhà xưởng mẫu 'BFF'
INSERT INTO fulfill_suppliers (code, name, contact_name, is_active, notes)
VALUES ('BFF', 'Xưởng BFF', 'BFF Team', true, 'Nhà xưởng gia công chính cho EVERPHANT và FASTPEACE')
ON CONFLICT (code) DO NOTHING;
