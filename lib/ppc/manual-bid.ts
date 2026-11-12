// Tab Manual Bid: phân nấc target theo ACOS và tính bid mới khi sửa hàng loạt.

export type ManualBidTier = "A20" | "A40" | "A60" | "A60P" | "NO_ORDER" | "OTHER";

/** Thứ tự hiển thị: ACOS cao → thấp (cần xử lý trước), rồi 0 order >7 click, cuối cùng Khác. */
export const MANUAL_BID_TIERS: Array<{ key: ManualBidTier; label: string }> = [
  { key: "A60P", label: ">60%" },
  { key: "A60", label: "40–60%" },
  { key: "A40", label: "20–40%" },
  { key: "A20", label: "0–20%" },
  { key: "NO_ORDER", label: "0 order >7 click" },
  { key: "OTHER", label: "Khác" },
];

export const NO_ORDER_CLICK_THRESHOLD = 7;

export function manualBidTier(m: { clicks: number; orders: number; spend: number; sales: number }): ManualBidTier {
  if (m.orders > 0 && m.sales > 0) {
    const acos = (m.spend / m.sales) * 100;
    if (acos <= 20) return "A20";
    if (acos <= 40) return "A40";
    if (acos <= 60) return "A60";
    return "A60P";
  }
  if (m.orders === 0 && m.clicks > NO_ORDER_CLICK_THRESHOLD) return "NO_ORDER";
  return "OTHER";
}

/** Dạng chạy lấy từ tên campaign ("BTV260203MR SP03 KW Exact FBA ..." → SP03); không có thì theo loại quảng cáo. */
export function runTypeFromCampaign(campaignName: string, adType: string): string {
  const m = /(?:^|[^A-Z0-9])(SP|SB|SD)\s?(\d{2})(?![0-9])/i.exec(campaignName || "");
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  return (adType || "SP").toUpperCase();
}

export type BulkBidOp =
  | { kind: "set"; value: number }
  | { kind: "pct"; value: number }
  | { kind: "add"; value: number }
  | { kind: "cpc"; value: number }
  | { kind: "mul"; value: number };

export function minBidFor(adType: string): number {
  return (adType || "").toUpperCase() === "SB" ? 0.1 : 0.02;
}

export function applyBidOp(op: BulkBidOp, row: { bid: number; cpc: number; adType: string }): number | null {
  let next: number;
  switch (op.kind) {
    case "set": next = op.value; break;
    case "pct": next = row.bid * (1 + op.value / 100); break;
    case "add": next = row.bid + op.value; break;
    case "mul":
      if (!(op.value > 0)) return null;
      next = row.bid * op.value;
      break;
    case "cpc":
      if (!(row.cpc > 0)) return null;
      next = row.cpc * (op.value || 1);
      break;
  }
  if (!Number.isFinite(next)) return null;
  return Math.round(Math.min(100, Math.max(minBidFor(row.adType), next)) * 100) / 100;
}

export type SkuMetricKey = "spend" | "sales" | "acos" | "clicks" | "orders" | "cpc" | "cvr";

export const SKU_METRICS: Array<{ key: SkuMetricKey; label: string; unit: "$" | "%" | "" }> = [
  { key: "spend", label: "Spend", unit: "$" },
  { key: "sales", label: "Sales", unit: "$" },
  { key: "acos", label: "ACOS", unit: "%" },
  { key: "clicks", label: "Click", unit: "" },
  { key: "orders", label: "Order", unit: "" },
  { key: "cpc", label: "CPC", unit: "$" },
  { key: "cvr", label: "CVR", unit: "%" },
];

export type MetricRange = { min: string; max: string };

export interface SkuListFilter {
  search: string;
  phoi: string;
  niche: string;
  pic: string;
  tiers: ManualBidTier[];
  ranges: Partial<Record<SkuMetricKey, MetricRange>>;
}

export const EMPTY_SKU_FILTER: SkuListFilter = { search: "", phoi: "", niche: "", pic: "", tiers: [], ranges: {} };

type SkuLike = {
  sku: string; asin?: string | null; productType?: string | null; niche?: string | null; picMkt?: string | null;
  clicks: number; orders: number; spend: number; sales: number;
};

/** Giá trị chỉ số của 1 SKU; null khi không tính được (ACOS chưa có sales, CPC/CVR chưa có click). */
export function skuMetric(g: SkuLike, key: SkuMetricKey): number | null {
  switch (key) {
    case "acos": return g.sales > 0 ? (g.spend / g.sales) * 100 : null;
    case "cpc": return g.clicks > 0 ? g.spend / g.clicks : null;
    case "cvr": return g.clicks > 0 ? (g.orders / g.clicks) * 100 : null;
    default: return g[key];
  }
}

export function activeRanges(f: SkuListFilter): Array<{ key: SkuMetricKey; min: number | null; max: number | null }> {
  const out: Array<{ key: SkuMetricKey; min: number | null; max: number | null }> = [];
  for (const m of SKU_METRICS) {
    const r = f.ranges?.[m.key];
    const min = r?.min ? parseFloat(r.min) : NaN;
    const max = r?.max ? parseFloat(r.max) : NaN;
    if (Number.isFinite(min) || Number.isFinite(max)) {
      out.push({ key: m.key, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null });
    }
  }
  return out;
}

/** Ô tìm nhận nhiều từ (cách nhau dấu cách / phẩy / xuống dòng): SKU khớp 1 trong các từ là được. */
export function searchTokens(search: string): string[] {
  return search.toLowerCase().split(/[\s,;]+/).filter(Boolean);
}

type Facet = "phoi" | "niche" | "pic";

/**
 * Lọc SKU theo mọi điều kiện trừ nấc ACOS (để đếm số SKU từng nấc).
 * skipFacet: bỏ qua 1 trong phôi/niche/PIC — dùng để dựng danh sách lựa chọn phụ thuộc lẫn nhau.
 */
export function filterSkusExceptTier<T extends SkuLike>(list: T[], f: SkuListFilter, skipFacet?: Facet): T[] {
  const tokens = searchTokens(f.search);
  const ranges = activeRanges(f);
  return list.filter((g) => {
    if (skipFacet !== "phoi" && f.phoi && (g.productType || "") !== f.phoi) return false;
    if (skipFacet !== "niche" && f.niche && (g.niche || "") !== f.niche) return false;
    if (skipFacet !== "pic" && f.pic && (g.picMkt || "") !== f.pic) return false;
    for (const r of ranges) {
      const v = skuMetric(g, r.key);
      if (v == null) return false;
      if (r.min != null && v < r.min) return false;
      if (r.max != null && v > r.max) return false;
    }
    if (tokens.length > 0) {
      const hay = `${g.sku} ${g.asin || ""} ${g.productType || ""} ${g.niche || ""}`.toLowerCase();
      if (!tokens.some((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Lựa chọn phôi / niche / PIC còn khớp với các bộ lọc khác (chọn phôi trước thì niche chỉ còn niche của phôi đó, và ngược lại). */
export function facetOptions<T extends SkuLike>(list: T[], f: SkuListFilter, facet: Facet): string[] {
  const pick = (g: T) => (facet === "phoi" ? g.productType : facet === "niche" ? g.niche : g.picMkt) || "";
  const vals = new Set(filterSkusExceptTier(list, { ...f, tiers: [] }, facet).map(pick).map((v) => v.trim()).filter(Boolean));
  const current = f[facet];
  if (current) vals.add(current);
  return Array.from(vals).sort();
}
