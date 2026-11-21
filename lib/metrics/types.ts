// Danh mục chỉ số (semantic layer): mỗi con số trên web được khai báo MỘT lần — công thức, chỉ số đầu vào,
// nguồn dữ liệu, quy tắc nghiệp vụ, các kiểm tra chất lượng dữ liệu liên quan.
// Agent giải thích mọi con số bằng cùng một bộ máy (engine.ts) thay vì viết tool riêng cho từng câu hỏi.
// Mô hình theo dbt MetricFlow: chỉ số gốc (base) / dẫn xuất tuyến tính (derived) / tỷ lệ (ratio).

export type MetricUnit = "usd" | "count" | "ratio";

export interface MetricTerm {
  metric: string;
  sign: 1 | -1;
}

interface MetricBase<Row> {
  id: string;
  label: string;
  /** Tên gọi khác người dùng hay dùng (tiếng Việt / tiếng Anh) để agent tìm đúng chỉ số. */
  aliases: string[];
  unit: MetricUnit;
  description: string;
  /** Đọc giá trị chỉ số từ một dòng tổng hợp (kỳ, store, kênh, ngày, SKU…). */
  value: (row: Row) => number;
  /** Quy tắc tính đúng như code đang chạy (theo kênh nếu khác nhau). */
  rules?: { common?: string[]; FBA?: string[]; FBM?: string[] };
  /** Bảng / file gốc của số liệu. */
  sources?: string[];
  /** Mã các kiểm tra chất lượng dữ liệu nên chạy khi số này "lạ". */
  checks?: string[];
  /** Thành phần có thể truy ra dòng gốc (trace). */
  traceable?: boolean;
}

/** Cộng được qua store / ngày / SKU. */
export interface BaseMetric<Row> extends MetricBase<Row> {
  kind: "base";
}

/** Tổ hợp tuyến tính của chỉ số khác (vd Profit = Revenue − Ads − …). Cộng được. */
export interface DerivedMetric<Row> extends MetricBase<Row> {
  kind: "derived";
  formula: string;
  terms: MetricTerm[];
}

/** Tỷ lệ = tử / mẫu (vd Margin = Profit / Revenue). KHÔNG cộng được — phải tính lại từ tử và mẫu. */
export interface RatioMetric<Row> extends MetricBase<Row> {
  kind: "ratio";
  formula: string;
  numerator: string;
  denominator: string;
}

export type MetricDefinition<Row> = BaseMetric<Row> | DerivedMetric<Row> | RatioMetric<Row>;

/** Một lát cắt dữ liệu (store, kênh, ngày, SKU…) với dòng tổng hợp của nó. */
export interface MetricSegment<Row> {
  key: string;
  label: string;
  row: Row;
}
