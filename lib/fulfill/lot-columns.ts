import type { FulfillLotLine } from "./types";

// TIÊU ĐỀ CỘT PHẢI GIỐNG HỆT SHEET GỬI XƯỞNG ("FBA BFF November 26 - Everphant"), kể cả chữ sai chính tả
// "Final Basecose". Người dùng yêu cầu bám sát sheet để xưởng đọc / in và đối chiếu trả tiền — KHÔNG dịch, KHÔNG đổi tên.
// Form tạo yêu cầu, bảng chi tiết lô và file Excel đều lấy tiêu đề từ đây.
export const SHEET_HEADERS = {
  name: "Name",
  sup: "Sup",
  ngay_request: "Date request",
  order_date: "Order date",
  product_type: "Type",
  mockup: "Image",
  sku: "SKU",
  quantity_request: "Quantity",
  quantity: "Quantity/add",
  line_ship: "Line ship",
  dimensions: "Dimensions",
  base_cost_per_unit: "Real basecost 15 days",
  note: "Note",
  card: "Card fee",
  tag: "Tag fee",
  stand_fee: "Stand fee",
  hop_tui: "box/bag fee",
  final_basecost: "Final Basecose",
  real_total: "Real total",
  file_design: "Design",
  card_design: "Card (11x8cm)",
  card_back: "Design Card Back",
  thankyou_card: "Thank you card (8x11cm)",
  tag_design: "Tag (5*15cm)",
  box_design: "Design box",
  box_quantity: "one box quantity",
  transparency_code: "Transparency Code",
  fnsku: "FNSKU",
  label_fnsku: "Label FNSKU",
  shipment_id: "Shipment ID",
  check_ship: "Check",
  box_count: "Box Quantity",
  shipping_label: "Shipping label 1",
  shipping_address: "Shipping address 1",
  ngay_di: "Shipping out Date",
  ngay_den: "Arrival date",
  replacement_fee: "Replacement Fee",
  request: "Request",
  sample_link: "Sample Link",
  label_link: "Label Link",
  package_link: "Package Link",
  check_final: "Check",
} as const satisfies Partial<Record<keyof FulfillLotLine, string>>;

// group: order = bên mình điền, ship = phần đóng gói / xưởng / vận chuyển (tiêu đề cam như sheet),
// amazon = thêm ngoài sheet: trạng thái Amazon & thanh toán (để đối chiếu trả tiền).
export type LotColumnKind = "text" | "int" | "money" | "link" | "image" | "date";

export interface LotColumn {
  key: keyof FulfillLotLine;
  header: string;
  group: "order" | "ship" | "amazon";
  kind: LotColumnKind;
  width: number;
}

const col = (key: keyof typeof SHEET_HEADERS, group: LotColumn["group"], kind: LotColumnKind, width: number): LotColumn => ({
  key,
  header: SHEET_HEADERS[key],
  group,
  kind,
  width,
});

/** Đúng thứ tự cột của sheet gửi xưởng, rồi 3 cột Amazon / thanh toán ở cuối. */
export const LOT_COLUMNS: LotColumn[] = [
  col("name", "order", "text", 13),
  col("sup", "order", "text", 9),
  col("ngay_request", "order", "date", 12),
  col("order_date", "order", "date", 12),
  col("product_type", "order", "text", 12),
  col("mockup", "order", "image", 12),
  col("sku", "order", "text", 18),
  col("quantity_request", "order", "int", 10),
  col("quantity", "order", "int", 12),
  col("line_ship", "order", "text", 14),
  col("dimensions", "order", "text", 12),
  col("base_cost_per_unit", "order", "money", 12),
  col("note", "order", "text", 24),
  col("card", "order", "money", 10),
  col("tag", "order", "money", 10),
  col("stand_fee", "order", "money", 10),
  col("hop_tui", "order", "money", 11),
  col("final_basecost", "order", "money", 13),
  col("real_total", "order", "money", 12),
  col("file_design", "order", "link", 14),
  col("card_design", "order", "link", 14),
  col("card_back", "order", "link", 14),
  col("thankyou_card", "order", "link", 14),
  col("tag_design", "order", "link", 14),
  col("box_design", "order", "link", 14),
  col("box_quantity", "order", "int", 12),
  col("transparency_code", "ship", "text", 15),
  col("fnsku", "ship", "text", 13),
  col("label_fnsku", "ship", "link", 13),
  col("shipment_id", "ship", "text", 15),
  col("check_ship", "ship", "text", 10),
  col("box_count", "ship", "int", 11),
  col("shipping_label", "ship", "link", 15),
  col("shipping_address", "ship", "text", 22),
  col("ngay_di", "ship", "date", 14),
  col("ngay_den", "ship", "date", 12),
  col("replacement_fee", "ship", "money", 13),
  col("request", "ship", "text", 18),
  col("sample_link", "ship", "link", 14),
  col("label_link", "ship", "link", 14),
  col("package_link", "ship", "link", 14),
  col("check_final", "ship", "text", 10),
  { key: "status", header: "Status Amazon", group: "amazon", kind: "text", width: 13 },
  { key: "so_luong_amazon_nhan", header: "Amazon nhận", group: "amazon", kind: "int", width: 11 },
  { key: "ngay_thanh_toan", header: "Ngày thanh toán", group: "amazon", kind: "date", width: 14 },
];

export const LOT_EDIT_FIELDS = {
  sup: "column",
  ngay_request: "column",
  order_date: "custom",
  product_type: "column",
  quantity_request: "custom",
  quantity: "column",
  line_ship: "column",
  dimensions: "custom",
  base_cost_per_unit: "column",
  note: "column",
  card: "column",
  tag: "column",
  stand_fee: "custom",
  hop_tui: "column",
  file_design: "custom",
  card_design: "custom",
  card_back: "custom",
  thankyou_card: "custom",
  tag_design: "custom",
  box_design: "custom",
  box_quantity: "custom",
} as const satisfies Partial<Record<keyof FulfillLotLine, "column" | "custom">>;

export function isLotEditField(key: string): key is keyof typeof LOT_EDIT_FIELDS {
  return Object.hasOwn(LOT_EDIT_FIELDS, key);
}
