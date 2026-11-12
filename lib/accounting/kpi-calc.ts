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
  /** "Lưu kho + CP khác" đúng như cột của sheet ở các nhóm kết quả tháng (công thức tuỳ tab nguồn) */
  storage_other: number;
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
  "storage_other",
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
    storage_other: 0,
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
  /** Basecost/unit, Amazon fee/unit leader điền trên sheet; trống thì dùng số hệ thống */
  basecost_unit?: number | null;
  amazon_fee_unit?: number | null;
  /** Dòng leader gõ tay số trên sheet: dùng nguyên các số này thay cho công thức (chi phí số dương) */
  sheet_metrics?: Partial<KpiMetrics> | null;
}

export interface KpiUnitEconomics {
  /** Giá bán mặc định khi leader chưa nhập giá */
  price: number | null;
  basecost_unit: number | null;
  amazon_fee_unit: number | null;
  referral_pct: number | null;
}

/**
 * Công thức khối "Kết quả kinh doanh mục tiêu" — mỗi store một kiểu (đọc từ sheet KẾ HOẠCH khi nạp, sửa tay được):
 *  - FASTPEACE/LIMIMA/WARMSTOREY: AMZ Fee = Unit × Amazon fee + 15% REV; Return = 2% REV
 *  - BOZSPACER: như trên, Return = 3% REV
 *  - MALFIRST: AMZ Fee = 33% REV; Return = Return thực tế tháng trước tháng mục tiêu (=BH)
 * Ref tax = 10% × 15% REV, Ads tax = 10% Ads, TNCN = 1% REV ở mọi store.
 */
export interface KpiTargetFormula {
  /** "unit_plus_pct": Unit × Amazon fee/unit + pct × REV; "revenue_pct": pct × REV */
  amazon_mode: "unit_plus_pct" | "revenue_pct";
  amazon_pct: number;
  /** % referral dùng cho Ref tax (Ref tax = 10% × ref_pct × REV) */
  ref_pct: number;
  /** "rate": return_rate × REV; "actual": Return thực tế tháng trước tháng mục tiêu */
  return_mode: "rate" | "actual";
  return_rate: number;
  /**
   * Cột "[Target] Tăng trưởng/tháng trước" của BÁO CÁO THÁNG: mục tiêu tháng sau ÷ (mục tiêu | thực tế) tháng đang xem,
   * có / không trừ 1. FASTPEACE: J/C−1; LIMIMA: J/E−1; WARMSTOREY, MALFIRST: J/E; BOZSPACER: J/C.
   */
  growth_base: "target" | "actual";
  growth_minus_one: boolean;
  /** Dòng "CP khác" tháng đang xem: 1 = như hệ thống (FASTPEACE "=-SUM"), -1 = đảo dấu (sheet "=SUM") */
  other_fee_sign: 1 | -1;
}

export const DEFAULT_TARGET_FORMULA: KpiTargetFormula = {
  amazon_mode: "unit_plus_pct",
  amazon_pct: 0.15,
  ref_pct: 0.15,
  return_mode: "rate",
  return_rate: KPI_RETURN_RATE,
  growth_base: "target",
  growth_minus_one: true,
  other_fee_sign: 1,
};

export function normalizeTargetFormula(v: unknown): KpiTargetFormula {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pct = (x: unknown, d: number) => (x != null && x !== "" && Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 1 ? Number(x) : d);
  return {
    amazon_mode: o.amazon_mode === "revenue_pct" ? "revenue_pct" : "unit_plus_pct",
    amazon_pct: pct(o.amazon_pct, o.amazon_mode === "revenue_pct" ? 0.33 : 0.15),
    ref_pct: pct(o.ref_pct, 0.15),
    return_mode: o.return_mode === "actual" ? "actual" : "rate",
    return_rate: pct(o.return_rate, KPI_RETURN_RATE),
    growth_base: o.growth_base === "actual" ? "actual" : "target",
    growth_minus_one: o.growth_minus_one === false || o.growth_minus_one === "false" ? false : true,
    other_fee_sign: Number(o.other_fee_sign) === -1 ? -1 : 1,
  };
}

/**
 * Mục tiêu đầy đủ từ các ô leader nhập; null khi chưa nhập Unit.
 * returnActual: Return thực tế (số dương) của tháng trước tháng mục tiêu — dùng khi formula.return_mode = "actual".
 */
export function computeTarget(
  input: KpiTargetInput | null | undefined,
  unit: KpiUnitEconomics,
  formula: KpiTargetFormula = DEFAULT_TARGET_FORMULA,
  returnActual: number | null = null,
): KpiMetrics | null {
  if (!input || input.units == null) return null;
  if (input.sheet_metrics && input.sheet_metrics.revenue != null) {
    const m = { ...emptyMetrics(), ...input.sheet_metrics };
    m.storage_other = m.storage_fee;
    return m;
  }
  const units = input.units;
  const price = unit.price ?? input.price ?? 0;
  const revenue = units * price;
  const ads = (input.tacos ?? 0) * revenue;
  const basecost = units * (input.basecost_unit ?? unit.basecost_unit ?? 0);
  const amazon =
    formula.amazon_mode === "revenue_pct"
      ? formula.amazon_pct * revenue
      : units * (input.amazon_fee_unit ?? unit.amazon_fee_unit ?? 0) + formula.amazon_pct * revenue;
  const adsTax = KPI_ADS_TAX_RATE * ads;
  const tncn = KPI_TNCN_RATE * revenue;
  const refTax = 0.1 * formula.ref_pct * revenue;
  const ret = formula.return_mode === "actual" ? (returnActual ?? 0) : formula.return_rate * revenue;
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
    storage_other: storage,
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
  // Như sheet: =IFERROR(a/b-1)
  return a / b - 1;
}

/** Tỷ lệ như các cột "[Result] Tăng trưởng" / "Tỷ lệ đạt KPI" của BÁO CÁO THÁNG: =IFERROR(a/b) */
export function ratioOf(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || Math.abs(b) < 1e-9) return null;
  return a / b;
}

/** "Lưu kho + CP khác" như CHI TIẾT SKU (các nhóm kết quả tháng): phần còn lại sau các khoản tách riêng */
export function storageAndOther(m: KpiMetrics): number {
  return m.storage_other;
}

/** Phần còn lại sau các khoản tách riêng (= cột "Lưu kho + CP khác" của tab INPUT tháng trước, dữ liệu năm nay) */
export function residualOther(m: Omit<KpiMetrics, "storage_other">): number {
  return m.revenue - m.ads_fee - m.basecost - m.amazon_fee - m.ads_tax - m.tncn_tax - m.ref_tax - m.return_amount - m.profit;
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

// ───────────── BÁO CÁO THÁNG (tab "BÁO CÁO THÁNG <n>") ─────────────
// Tổng team = SKU phát triển; SKU test = dòng "P/L SKU testing".
// - Cột kết quả tháng cũ (tháng trước, cùng kỳ, cùng kỳ tháng sau): "Chi phí lưu kho" = Lưu kho + CP khác gộp,
//   Gross Profit = tổng Profit SKU (=SUM cột Profit của CHI TIẾT SKU).
// - Cột kết quả tháng đang báo cáo: tách Lưu kho / CP khác / Adjustment / Placement Fee;
//   Gross Profit = SUM(Profit) + AWD/Subscription (ô 'INPUT KQ hiện tại'!AE2) − Adjustment + Placement Fee.
//   Adjustment hiện dấu như sheet (chi phí là số âm), Placement Fee là số dương.
// - Tăng trưởng/tháng trước = E/B, Tăng trưởng/cùng kỳ = E/D, Tỷ lệ đạt KPI = E/C (Revenue, Quantity, Ads, TAcos, Gross Profit),
//   [Target] Tăng trưởng/tháng trước = J/C − 1.

export const REPORT_ROWS = [
  { key: "revenue", label: "Revenue", kind: "usd" },
  { key: "quantity", label: "Quantity", kind: "int" },
  { key: "ads_fee", label: "Ads Fee", kind: "usd" },
  { key: "basecost", label: "Basecost", kind: "usd" },
  { key: "amazon_fee", label: "Amazon Fee", kind: "usd" },
  { key: "tacos", label: "TAcos", kind: "pct" },
  { key: "ads_tax", label: "Ads tax fee 10% Ads", kind: "usd" },
  { key: "tncn_tax", label: "TNCN tax 1% Rev", kind: "usd" },
  { key: "ref_tax", label: "Ref tax", kind: "usd" },
  { key: "return_amount", label: "Return", kind: "usd" },
  { key: "storage", label: "Chi phí lưu kho", kind: "usd" },
  { key: "other_fee", label: "CP khác", kind: "usd" },
  { key: "gross", label: "Gross Profit", kind: "usd" },
  { key: "adjustment", label: "Adjustment", kind: "usd" },
  { key: "placement_fee", label: "Placement Fee", kind: "usd" },
  { key: "pl_test", label: "P/L SKU testing", kind: "usd" },
] as const;
export type ReportRowKey = (typeof REPORT_ROWS)[number]["key"];
/**
 * cur = SKU WIN tháng đang xem (như sheet: tăng trưởng, % đạt KPI, [Target] Tăng trưởng tính trên cột này);
 * curTotal = tổng team (SKU WIN + SKU TEST); curTest = SKU TEST.
 */
export type ReportCol =
  | "prev"
  | "tCur"
  | "tCurTest"
  | "ly"
  | "cur"
  | "curTotal"
  | "curTest"
  | "kpiTest"
  | "rPrev"
  | "rLy"
  | "kpi"
  | "lyNext"
  | "tNextDev"
  | "tNextGrowth"
  | "tNextTest";
export type MonthReport = Record<ReportRowKey, Partial<Record<ReportCol, number | null>>>;

export interface MonthReportInput {
  dev: { prev: KpiMetrics | null; cur: KpiMetrics | null; ly: KpiMetrics | null; lyNext: KpiMetrics | null; tCur: KpiMetrics | null; tNext: KpiMetrics | null };
  test: {
    prev: KpiMetrics | null;
    cur: KpiMetrics | null;
    ly: KpiMetrics | null;
    lyNext: KpiMetrics | null;
    tNext: KpiMetrics | null;
    /** Mục tiêu SKU TEST tháng đang xem (cột [Target] SKU TEST) */
    tCur?: KpiMetrics | null;
  };
  /** Phí AWD/Subscription/Disposal cấp store của tháng đang báo cáo (chi phí dương) */
  storeFeeCur: number | null;
  /** Công thức của store (cột tăng trưởng mục tiêu, dấu CP khác); bỏ trống = như FASTPEACE */
  formula?: KpiTargetFormula | null;
}

const KPI_ROWS = new Set<ReportRowKey>(["revenue", "quantity", "ads_fee", "tacos", "gross"]);

function pastValue(m: KpiMetrics | null, key: ReportRowKey): number | null {
  if (!m) return null;
  switch (key) {
    case "tacos":
      return tacosOf(m);
    case "storage":
      return storageAndOther(m);
    case "gross":
      return m.profit;
    case "other_fee":
    case "adjustment":
    case "placement_fee":
    case "pl_test":
      return null;
    default:
      return m[key];
  }
}
function currentValue(m: KpiMetrics | null, key: ReportRowKey, storeFee: number | null): number | null {
  if (!m) return null;
  switch (key) {
    case "tacos":
      return tacosOf(m);
    case "storage":
      return m.storage_fee;
    case "other_fee":
      return m.other_fee;
    case "adjustment":
      return -m.adjustment;
    case "placement_fee":
      return m.placement_fee;
    case "gross":
      return m.profit - (storeFee ?? 0) + m.adjustment + m.placement_fee;
    case "pl_test":
      return null;
    default:
      return m[key];
  }
}
function targetValue(m: KpiMetrics | null, key: ReportRowKey): number | null {
  if (!m) return null;
  switch (key) {
    case "tacos":
      return tacosOf(m);
    case "storage":
      return m.storage_fee;
    case "gross":
      return m.profit;
    case "other_fee":
    case "adjustment":
    case "placement_fee":
    case "pl_test":
      return null;
    default:
      return m[key];
  }
}

export function buildMonthReport(input: MonthReportInput): MonthReport {
  const { dev, test } = input;
  const f = input.formula ?? DEFAULT_TARGET_FORMULA;
  const out = {} as MonthReport;
  for (const { key } of REPORT_ROWS) {
    const isKpi = KPI_ROWS.has(key);
    if (key === "pl_test") {
      const prev = test.prev?.profit ?? null;
      const cur = test.cur?.profit ?? null;
      const tCurTestProfit = test.tCur?.profit ?? null;
      out[key] = {
        prev,
        ly: test.ly?.profit ?? null,
        cur,
        curTotal: cur,
        curTest: cur,
        tCurTest: tCurTestProfit,
        kpiTest: isKpi ? ratioOf(cur, tCurTestProfit) : null,
        rPrev: isKpi ? ratioOf(cur, prev) : null,
        rLy: isKpi ? ratioOf(cur, test.ly?.profit ?? null) : null,
        lyNext: test.lyNext?.profit ?? null,
        tNextTest: test.tNext?.profit ?? null,
      };
      continue;
    }
    const prev = pastValue(dev.prev, key);
    const ly = pastValue(dev.ly, key);
    const signed = (v: number | null) => (key === "other_fee" && v != null ? v * f.other_fee_sign : v);
    const cur = signed(currentValue(dev.cur, key, input.storeFeeCur));
    const curTest = signed(currentValue(test.cur, key, null));
    // Tổng team = SKU WIN + SKU TEST (cộng số liệu rồi tính, để TAcos đúng); phí cấp store chỉ trừ một lần
    const all = dev.cur || test.cur ? addMetrics(addMetrics(emptyMetrics(), dev.cur), test.cur) : null;
    const curAll = signed(currentValue(all, key, input.storeFeeCur));
    const tCur = targetValue(dev.tCur, key);
    const tCurTestVal = targetValue(test.tCur ?? null, key);
    const tNextDev = targetValue(dev.tNext, key);
    const g = (a: number | null, b: number | null) =>
      a == null || b == null || Math.abs(b) < 1e-9 ? null : a / b - (f.growth_minus_one ? 1 : 0);
    out[key] = {
      prev,
      tCur,
      ly,
      cur,
      curTotal: curAll,
      curTest,
      tCurTest: tCurTestVal,
      kpiTest: isKpi ? ratioOf(curTest, tCurTestVal) : null,
      rPrev: isKpi ? ratioOf(cur, prev) : null,
      rLy: isKpi ? ratioOf(cur, ly) : null,
      kpi: isKpi ? ratioOf(cur, tCur) : null,
      lyNext: pastValue(dev.lyNext, key),
      tNextDev,
      tNextGrowth: isKpi ? g(tNextDev, f.growth_base === "actual" ? cur : tCur) : null,
      tNextTest: targetValue(test.tNext, key),
    };
  }
  return out;
}
