export type FulfillPoStatus =
  | "draft"
  | "pending_sup"
  | "producing"
  | "shipped"
  | "received"
  | "cancelled";

export interface FulfillSupplier {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  notes: string | null;
  po_count?: number;
  created_at: string;
  updated_at: string;
}

export interface FulfillPo {
  id: string;
  po_number: string;
  store_id: string | null;
  store_name?: string | null;
  supplier_id: string;
  supplier_code?: string | null;
  supplier_name?: string | null;
  order_date: string;
  target_date: string | null;
  status: FulfillPoStatus;
  total_quantity: number;
  total_amount: number;
  notes: string | null;
  created_by: string | null;
  line_count?: number;
  created_at: string;
  updated_at: string;
}

export interface FulfillPoLine {
  id: string;
  po_id: string;
  row_order: number;

  // Nhóm 1: Bên mình điền
  product_type: string | null;
  sku: string;
  quantity: number;
  line_ship: string | null;
  dimensions: string | null;
  basecost: number;
  fee_card: number;
  fee_tag: number;
  fee_stand: number;
  fee_box: number;
  total_line_cost: number;
  design_url: string | null;
  card_url: string | null;
  tag_url: string | null;
  box_url: string | null;

  // Nhóm 2: Đóng gói FBA
  transparency_code: string | null;
  fnsku: string | null;
  label_fnsku: string | null;
  shipment_id: string | null;
  box_quantity: number | null;
  shipping_label: string | null;
  shipping_address: string | null;

  // Nhóm 3: Theo dõi xưởng & vận chuyển
  shipping_out_date: string | null;
  arrival_date: string | null;
  replacement_fee: number;
  sample_url: string | null;
  package_url: string | null;
  check_status: string | null;
  notes: string | null;

  created_at: string;
  updated_at: string;
}

export interface FulfillSkuMasterItem {
  id: string;
  store_id: string;
  store_name?: string | null;
  sku: string;
  asin: string | null;
  fnsku: string | null;
  transparency_code: string | null;
  product_name: string | null;
  dimensions: string | null;
  pcs_per_box: number;
  design_url: string | null;
  card_url: string | null;
  tag_url: string | null;
  box_url: string | null;
  basecost: number;
  fee_card: number;
  fee_tag: number;
  fee_stand: number;
  fee_box: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FulfillDashboardSummary {
  total_pos: number;
  total_producing: number;
  total_shipped: number;
  total_received: number;
  total_quantity: number;
  total_amount: number;
}

// ==========================================
// Đợt hàng đọc từ dữ liệu server: CHI TIẾT ĐI HÀNG (accounting_inbound_shipments)
// + Bảng Mã (accounting_sku_master) + Check Shipment Amazon (accounting_amazon_check_shipments).
// Một đợt = một "Tên lô" (giống một tab "FBA BFF November 26 - Everphant" trong sheet gửi xưởng).
// ==========================================

/** Giai đoạn của 1 dòng / 1 đợt, theo thứ tự tiến trình. */
export type FulfillLotStage = "waiting" | "in_transit" | "receiving" | "closed" | "cancelled";

export interface FulfillLot {
  key: string;
  lot_name: string;
  /** Dòng không có Tên lô: tên ghép từ Sup + Ngày request */
  lot_name_generated: boolean;
  store_id: string;
  store_name: string;
  sup: string | null;
  first_request: string | null;
  last_request: string | null;
  sku_count: number;
  quantity: number;
  amount: number;
  paid_amount: number;
  shipment_ids: string[];
  units_expected: number;
  units_located: number;
  stage: FulfillLotStage;
  stage_counts: Record<FulfillLotStage, number>;
}

export interface FulfillLotLine {
  id: string;
  row_order: number;
  name: string;
  sup: string | null;
  ngay_request: string | null;
  order_date: string | null;
  product_type: string | null;
  mockup: string | null;
  sku: string;
  quantity: number;
  quantity_request: number | null;
  line_ship: string | null;
  dimensions: string | null;
  base_cost_per_unit: number | null;
  stand_fee: number | null;
  card: number | null;
  tag: number | null;
  shipping_fee: number | null;
  hop_tui: number | null;
  final_basecost: number | null;
  real_total: number;
  file_design: string | null;
  card_design: string | null;
  card_back: string | null;
  thankyou_card: string | null;
  tag_design: string | null;
  box_design: string | null;
  box_quantity: number | null;
  source: string | null;
  // Phần xưởng / đóng gói FBA của sheet (lưu ở custom_fields cho tới khi có cột riêng)
  transparency_code: string | null;
  fnsku: string | null;
  label_fnsku: string | null;
  shipment_id: string | null;
  check_ship: string | null;
  box_count: number | null;
  shipping_label: string | null;
  shipping_address: string | null;
  replacement_fee: number | null;
  request: string | null;
  sample_link: string | null;
  label_link: string | null;
  package_link: string | null;
  check_final: string | null;
  ngay_di: string | null;
  ngay_den: string | null;
  status: string | null;
  so_luong_amazon_nhan: number | null;
  ngay_thanh_toan: string | null;
  note: string | null;
  trang_thai: string | null;
  stage: FulfillLotStage;
}
