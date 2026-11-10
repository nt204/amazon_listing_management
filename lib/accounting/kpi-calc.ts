// Công thức KPI kinh doanh dùng chung server + giao diện (không import server-only).
// Bám file "<STORE> - KẾ HOẠCH KINH DOANH 2026", nhóm cột "Kết quả kinh doanh mục tiêu":
//   REV = Unit × Price; Ads = TACoS × REV; Basecost = Unit × basecost/unit;
//   AMZ Fee = Unit × (Amazon fee/unit + %Referral × Price);
//   Thuế = 10% Ads + 1% REV (TNCN) + 10% × %Referral × REV (Ref tax);
//   Return = 2% REV; Lưu kho = leader nhập; Gross Profit = REV − mọi chi phí.

/**
 * Chi phí là số dương, tách như sheet (BÁO CÁO THÁNG / CHI TIẾT SKU).
 * profit (Profit SKU) = revenue − ads − basecost − amazon_fee − ads_tax − tncn_tax − ref_tax − return
 *                       − storage_fee − other_fee − adjustment − placement_fee
 * Gross Profit của BÁO CÁO THÁNG = profit + adjustment + placement_fee (sheet tách 2 khoản này xuống dưới).
 */
export interface KpiMetrics {
  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  ads_tax: number;
  tncn_tax: number;
  ref_tax: number;
  return_amount: number;
  storage_fee: number;
  other_fee: number;
  adjustment: number;
  placement_fee: number;
  profit: number;
}

export const KPI_METRIC_KEYS: (keyof KpiMetrics)[] = [
  "revenue",
  "quantity",
  "ads_fee",
  "basecost",
  "amazon_fee",
  "ads_tax",
  "tncn_tax",
  "ref_tax",
  "return_amount",
  "storage_fee",
  "other_fee",
  "adjustment",
  "placement_fee",
  "profit",
];

/** Gross Profit như BÁO CÁO THÁNG: chưa trừ Adjustment, Placement Fee */
export function grossProfit(m: KpiMetrics | null | undefined): number | null {
  return m ? m.profit + m.adjustment + m.placement_fee : null;
}

/**
 * Tách tổng thuế của SKU Monthly / Lọc SKU Win thành 3 dòng như sheet: Ads tax = 10% Ads, TNCN = 1% Rev, Ref tax = phần còn lại.
 */
export function splitTax(thue: number, ads: number, revenue: number) {
  const ads_tax = KPI_ADS_TAX_RATE * ads;
  const tncn_tax = KPI_TNCN_RATE * revenue;
  return { ads_tax, tncn_tax, ref_tax: thue - ads_tax - tncn_tax };
}

export const KPI_RETURN_RATE = 0.02;
export const KPI_ADS_TAX_RATE = 0.1;
export const KPI_TNCN_RATE = 0.01;

export function emptyMetrics(): KpiMetrics {
  return {
    revenue: 0,
    quantity: 0,
    ads_fee: 0,
    basecost: 0,
    amazon_fee: 0,
    ads_tax: 0,
    tncn_tax: 0,
    ref_tax: 0,
    return_amount: 0,
    storage_fee: 0,
    other_fee: 0,
    adjustment: 0,
    placement_fee: 0,
    profit: 0,
  };
}

export function addMetrics(a: KpiMetrics, b: KpiMetrics | null | undefined): KpiMetrics {
  if (!b) return a;
  const out = { ...a };
  for (const k of KPI_METRIC_KEYS) out[k] += b[k] || 0;
  return out;
}

export interface KpiTargetInput {
  units: number | null;
  tacos: number | null;
  price: number | null;
  storage_fee: number | null;
}

export interface KpiUnitEconomics {
  /** Giá bán mặc định khi leader chưa nhập giá */
  price: number | null;
  basecost_unit: number | null;
  amazon_fee_unit: number | null;
  referral_pct: number | null;
}

/** Mục tiêu đầy đủ từ các ô leader nhập; null khi chưa nhập Unit */
export function computeTarget(input: KpiTargetInput | null | undefined, unit: KpiUnitEconomics): KpiMetrics | null {
  if (!input || input.units == null) return null;
  const units = input.units;
  const price = input.price ?? unit.price ?? 0;
  const ref = unit.referral_pct ?? 0.15;
  const revenue = units * price;
  const ads = (input.tacos ?? 0) * revenue;
  const basecost = units * (unit.basecost_unit ?? 0);
  const amazon = units * ((unit.amazon_fee_unit ?? 0) + ref * price);
  const adsTax = KPI_ADS_TAX_RATE * ads;
  const tncn = KPI_TNCN_RATE * revenue;
  const refTax = 0.1 * ref * revenue;
  const ret = KPI_RETURN_RATE * revenue;
  const storage = input.storage_fee ?? 0;
  return {
    revenue,
    quantity: units,
    ads_fee: ads,
    basecost,
    amazon_fee: amazon,
    ads_tax: adsTax,
    tncn_tax: tncn,
    ref_tax: refTax,
    return_amount: ret,
    storage_fee: storage,
    other_fee: 0,
    adjustment: 0,
    placement_fee: 0,
    profit: revenue - ads - basecost - amazon - adsTax - tncn - refTax - ret - storage,
  };
}

export function tacosOf(m: KpiMetrics | null | undefined): number | null {
  return m && m.revenue ? m.ads_fee / m.revenue : null;
}

/** % đạt = thực tế ÷ mục tiêu (profit âm: so theo hiệu số để không đảo dấu) */
export function achievement(actual: number | null | undefined, target: number | null | undefined): number | null {
  if (actual == null || target == null || !target) return null;
  if (target > 0) return actual / target;
  return 1 + (actual - target) / Math.abs(target);
}

/** Tăng trưởng (a − b) / |b| */
export function growth(a: number | null | undefined, b: number | null | undefined): number | null {
  // Gốc so sánh dưới $1 (hoặc 1 đơn vị) thì % vô nghĩa → để trống
  if (a == null || b == null || Math.abs(b) < 1) return null;
  return (a - b) / Math.abs(b);
}

export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  return `T${Number(m)}/${y}`;
}
