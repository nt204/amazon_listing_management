// Bộ máy giải thích chỉ số — hàm thuần, không I/O, không AI: cùng đầu vào luôn ra cùng kết quả.
// Mọi phép bóc tách đều CỘNG ĐÚNG về tổng (không có phần "không giải thích được" do làm tròn công thức):
//   • Chỉ số dẫn xuất: Δ = Σ dấu × Δthành phần.
//   • Tỷ lệ N/D có tử tuyến tính: N/D = Σ dấu × thành phần/D ⇒ Δ = Σ dấu × (t₁/D₁ − t₀/D₀).
//   • Tỷ lệ theo lát cắt (store/SKU…): đóng góp_s = w₁(r₁ − r₀) [tỷ lệ đổi] + (w₁ − w₀)(r₀ − R₀) [tỷ trọng đổi],
//     w = tỷ trọng mẫu số; Σ mọi lát cắt = R₁ − R₀.

import type { MetricRegistry } from "@/lib/metrics/registry";
import type { MetricDefinition, MetricSegment, MetricUnit } from "@/lib/metrics/types";

export function roundFor(unit: MetricUnit, value: number) {
  if (!Number.isFinite(value)) return 0;
  const digits = unit === "ratio" ? 4 : 2;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

const safeDiv = (n: number, d: number) => (d > 0 ? n / d : 0);

export function describeMetric<Row>(def: MetricDefinition<Row>) {
  return {
    id: def.id,
    label: def.label,
    unit: def.unit,
    kind: def.kind,
    formula: def.kind === "base" ? undefined : def.formula,
    description: def.description,
  };
}

export interface MetricComponentValue {
  id: string;
  label: string;
  sign: "+" | "−";
  value: number;
}

export interface ExplainMetricResult {
  metric: ReturnType<typeof describeMetric>;
  value: number;
  /** Chỉ số dẫn xuất: giá trị từng thành phần. */
  components?: MetricComponentValue[];
  /** Chỉ số dẫn xuất: giá trị − Σ thành phần (≠ 0 nghĩa là công thức khai báo lệch với code). */
  formulaCheck?: number;
  numerator?: { id: string; label: string; value: number };
  denominator?: { id: string; label: string; value: number };
  /** Tỷ lệ có tử tuyến tính: mỗi thành phần của tử chia cho mẫu. */
  componentsOverDenominator?: { id: string; label: string; sign: "+" | "−"; ratio: number }[];
  note?: string;
}

const signOf = (sign: 1 | -1): "+" | "−" => (sign === 1 ? "+" : "−");

/** Giá trị + công thức + giá trị từng thành phần của 1 chỉ số trên 1 dòng tổng hợp. */
export function explainMetric<Row>(registry: MetricRegistry<Row>, def: MetricDefinition<Row>, row: Row): ExplainMetricResult {
  const value = def.value(row);
  const base = { metric: describeMetric(def), value: roundFor(def.unit, value) };

  if (def.kind === "derived") {
    const components = def.terms.map((t) => {
      const m = registry.require(t.metric);
      return { id: m.id, label: m.label, sign: signOf(t.sign), value: roundFor(m.unit, m.value(row)) };
    });
    const recomputed = def.terms.reduce((s, t) => s + t.sign * registry.require(t.metric).value(row), 0);
    return { ...base, components, formulaCheck: roundFor(def.unit, value - recomputed) };
  }

  if (def.kind === "ratio") {
    const num = registry.require(def.numerator);
    const den = registry.require(def.denominator);
    const n = num.value(row);
    const d = den.value(row);
    const result: ExplainMetricResult = {
      ...base,
      numerator: { id: num.id, label: num.label, value: roundFor(num.unit, n) },
      denominator: { id: den.id, label: den.label, value: roundFor(den.unit, d) },
    };
    if (d <= 0) result.note = `${den.label} = 0 nên ${def.label} hiển thị 0 (không chia được).`;
    else if (num.kind === "derived") {
      // vd Margin = Revenue/Revenue − Ads/Revenue − Basecost/Revenue − …: mỗi khoản chiếm bao nhiêu % mẫu số
      result.componentsOverDenominator = num.terms.map((t) => {
        const m = registry.require(t.metric);
        return { id: m.id, label: m.label, sign: signOf(t.sign), ratio: roundFor("ratio", m.value(row) / d) };
      });
    }
    return result;
  }

  return base;
}

export interface MetricDriver {
  id: string;
  label: string;
  current: number;
  previous: number;
  /** Đóng góp vào thay đổi của chỉ số (đã nhân dấu): cộng các driver = delta. */
  contribution: number;
}

export interface CompareMetricResult {
  metric: ReturnType<typeof describeMetric>;
  current: number;
  previous: number;
  delta: number;
  /** Thay đổi tương đối (null với tỷ lệ — dùng điểm % — hoặc khi kỳ trước = 0). */
  deltaPct: number | null;
  drivers?: (MetricDriver & { shareOfChange: number | null })[];
  note?: string;
}

/** So sánh 2 kỳ và chia mức thay đổi về từng thành phần. */
export function compareMetric<Row>(
  registry: MetricRegistry<Row>,
  def: MetricDefinition<Row>,
  current: Row,
  previous: Row,
): CompareMetricResult {
  const cur = def.value(current);
  const prev = def.value(previous);
  const delta = cur - prev;
  const out: CompareMetricResult = {
    metric: describeMetric(def),
    current: roundFor(def.unit, cur),
    previous: roundFor(def.unit, prev),
    delta: roundFor(def.unit, delta),
    deltaPct: def.unit === "ratio" || prev === 0 ? null : roundFor("ratio", delta / Math.abs(prev)),
  };

  let drivers: MetricDriver[] = [];
  if (def.kind === "derived") {
    drivers = def.terms.map((t) => {
      const m = registry.require(t.metric);
      const c = m.value(current);
      const p = m.value(previous);
      return { id: m.id, label: m.label, current: c, previous: p, contribution: t.sign * (c - p) };
    });
  } else if (def.kind === "ratio") {
    const num = registry.require(def.numerator);
    const den = registry.require(def.denominator);
    const d1 = den.value(current);
    const d0 = den.value(previous);
    if (d1 <= 0 || d0 <= 0) {
      out.note = `${den.label} của một kỳ bằng 0 nên không bóc tách được ${def.label}.`;
    } else if (num.kind === "derived") {
      drivers = num.terms.map((t) => {
        const m = registry.require(t.metric);
        const c = m.value(current);
        const p = m.value(previous);
        return { id: m.id, label: `${m.label}/${den.label}`, current: c / d1, previous: p / d0, contribution: t.sign * (c / d1 - p / d0) };
      });
    } else {
      const n1 = num.value(current);
      const n0 = num.value(previous);
      drivers = [
        { id: num.id, label: `Thay đổi ${num.label}`, current: n1, previous: n0, contribution: (n1 - n0) / d1 },
        { id: den.id, label: `Thay đổi ${den.label}`, current: d1, previous: d0, contribution: n0 / d1 - n0 / d0 },
      ];
    }
  }

  if (drivers.length) {
    const unitOf = (id: string) => (def.kind === "ratio" ? "ratio" : registry.require(id).unit);
    out.drivers = drivers
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .map((d) => ({
        ...d,
        current: roundFor(unitOf(d.id), d.current),
        previous: roundFor(unitOf(d.id), d.previous),
        contribution: roundFor(def.unit, d.contribution),
        shareOfChange: delta !== 0 ? roundFor("ratio", d.contribution / delta) : null,
      }));
  }
  return out;
}

function ratioParts<Row>(registry: MetricRegistry<Row>, def: MetricDefinition<Row>) {
  if (def.kind !== "ratio") return null;
  return { num: registry.require(def.numerator), den: registry.require(def.denominator) };
}

export interface BreakdownSegment {
  key: string;
  label: string;
  value: number;
  /** Chỉ số cộng được: tỷ trọng trong tổng. */
  share?: number | null;
  /** Tỷ lệ: tử / mẫu / tỷ trọng mẫu số / mức kéo tỷ lệ chung lên (+) hay xuống (−) so với trung bình. */
  numerator?: number;
  denominator?: number;
  weight?: number;
  impact?: number;
}

/** Giá trị theo từng lát cắt + tỷ trọng (chỉ số cộng được) hoặc mức kéo lên / kéo xuống (tỷ lệ). */
export function breakdownMetric<Row>(
  registry: MetricRegistry<Row>,
  def: MetricDefinition<Row>,
  segments: MetricSegment<Row>[],
  total: Row,
  top = 15,
) {
  const parts = ratioParts(registry, def);
  const totalValue = def.value(total);
  let rows: BreakdownSegment[];

  if (parts) {
    const N = parts.num.value(total);
    const D = parts.den.value(total);
    const R = safeDiv(N, D);
    rows = segments
      .map((s) => {
        const n = parts.num.value(s.row);
        const d = parts.den.value(s.row);
        // impact: lát cắt này kéo tỷ lệ chung lên (+) / xuống (−) bao nhiêu so với mức trung bình
        const impact = D > 0 ? (n - R * d) / D : 0;
        return { key: s.key, label: s.label, value: def.value(s.row), numerator: n, denominator: d, weight: safeDiv(d, D), impact };
      })
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .map((r) => ({
        ...r,
        value: roundFor("ratio", r.value),
        numerator: roundFor(parts.num.unit, r.numerator),
        denominator: roundFor(parts.den.unit, r.denominator),
        weight: roundFor("ratio", r.weight),
        impact: roundFor("ratio", r.impact),
      }));
  } else {
    rows = segments
      .map((s) => ({ key: s.key, label: s.label, value: def.value(s.row) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((r) => ({
        ...r,
        value: roundFor(def.unit, r.value),
        share: totalValue !== 0 ? roundFor("ratio", r.value / totalValue) : null,
      }));
  }

  const segmentSum = parts ? null : segments.reduce((s, seg) => s + def.value(seg.row), 0);
  return {
    metric: describeMetric(def),
    total: roundFor(def.unit, totalValue),
    segmentCount: segments.length,
    segments: rows.slice(0, top),
    omittedSegments: Math.max(0, rows.length - top),
    // Tổng các lát cắt khác tổng chung → có phần chưa gán được (vd SKU không có trong Bảng mã)
    unallocated: segmentSum == null ? null : roundFor(def.unit, totalValue - segmentSum),
  };
}

/** Lát cắt nào gây ra thay đổi giữa 2 kỳ (store / kênh / SKU…). Tổng đóng góp = delta. */
export function compareBreakdown<Row>(
  registry: MetricRegistry<Row>,
  def: MetricDefinition<Row>,
  current: MetricSegment<Row>[],
  previous: MetricSegment<Row>[],
  totals: { current: Row; previous: Row },
  top = 15,
) {
  const parts = ratioParts(registry, def);
  const keys = new Map<string, string>();
  for (const s of [...current, ...previous]) keys.set(s.key, s.label);
  const curBy = new Map(current.map((s) => [s.key, s.row]));
  const prevBy = new Map(previous.map((s) => [s.key, s.row]));

  let rows: {
    key: string;
    label: string;
    current: number | null;
    previous: number | null;
    contribution: number;
    rateEffect?: number;
    mixEffect?: number;
    weightCurrent?: number;
    weightPrevious?: number;
  }[];
  if (parts) {
    // Tỷ lệ chung R = Σ wₛ·rₛ (w = tỷ trọng mẫu số). Đóng góp của lát cắt = rateEffect + mixEffect:
    //   rateEffect = w₁(r₁ − r₀)        — do tỷ lệ của chính lát cắt đổi
    //   mixEffect  = (w₁ − w₀)(r₀ − R₀) — do tỷ trọng đổi (lát cắt tỷ lệ cao/thấp hơn trung bình chiếm nhiều/ít hơn)
    // Lát cắt mới xuất hiện: r₀ coi = R₀. Tổng mọi lát cắt = R₁ − R₀.
    const D1 = parts.den.value(totals.current);
    const D0 = parts.den.value(totals.previous);
    const R0 = safeDiv(parts.num.value(totals.previous), D0);
    rows = [...keys].map(([key, label]) => {
      const c = curBy.get(key);
      const p = prevBy.get(key);
      const w1 = c && D1 > 0 ? parts.den.value(c) / D1 : 0;
      const w0 = p && D0 > 0 ? parts.den.value(p) / D0 : 0;
      const r1 = c ? safeDiv(parts.num.value(c), parts.den.value(c)) : 0;
      const r0 = p && parts.den.value(p) > 0 ? parts.num.value(p) / parts.den.value(p) : R0;
      const rateEffect = c ? w1 * (r1 - r0) : 0;
      const mixEffect = (w1 - w0) * (r0 - R0);
      return {
        key,
        label,
        current: c ? def.value(c) : null,
        previous: p ? def.value(p) : null,
        contribution: rateEffect + mixEffect,
        rateEffect,
        mixEffect,
        weightCurrent: w1,
        weightPrevious: w0,
      };
    });
  } else {
    rows = [...keys].map(([key, label]) => {
      const c = curBy.has(key) ? def.value(curBy.get(key)!) : 0;
      const p = prevBy.has(key) ? def.value(prevBy.get(key)!) : 0;
      return { key, label, current: c, previous: p, contribution: c - p };
    });
  }
  rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const unit = def.unit;
  const delta = def.value(totals.current) - def.value(totals.previous);
  return {
    metric: describeMetric(def),
    delta: roundFor(unit, delta),
    segments: rows.slice(0, top).map((r) => ({
      ...r,
      current: r.current == null ? null : roundFor(unit, r.current),
      previous: r.previous == null ? null : roundFor(unit, r.previous),
      contribution: roundFor(unit, r.contribution),
      ...(r.rateEffect != null
        ? {
            rateEffect: roundFor("ratio", r.rateEffect),
            mixEffect: roundFor("ratio", r.mixEffect ?? 0),
            weightCurrent: roundFor("ratio", r.weightCurrent ?? 0),
            weightPrevious: roundFor("ratio", r.weightPrevious ?? 0),
          }
        : {}),
      shareOfChange: delta !== 0 ? roundFor("ratio", r.contribution / delta) : null,
    })),
    omittedSegments: Math.max(0, rows.length - top),
    ...(parts
      ? {
          howToRead:
            "contribution = rateEffect + mixEffect. rateEffect: do tỷ lệ của chính lát cắt thay đổi (× tỷ trọng kỳ này). mixEffect: do tỷ trọng (phần mẫu số) của lát cắt thay đổi — lát cắt có tỷ lệ cao hơn trung bình mà chiếm nhiều hơn thì kéo tỷ lệ chung lên. weight = tỷ trọng mẫu số.",
        }
      : {}),
  };
}
