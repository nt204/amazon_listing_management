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
