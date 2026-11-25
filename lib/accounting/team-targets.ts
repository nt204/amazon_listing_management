// Mục tiêu sếp giao cho team qua Lark (tag bot): "tuần cuối tháng 11 tối thiểu 3000 unit", "tuần 2: 10000 units",
// "mỗi ngày ~700", "cap margin: limima 10%". AI chỉ bóc ý (tháng, vị trí tuần, con số); code đổi ra khoảng ngày
// theo tuần 7 ngày. Thuần, không truy cập DB.
//
// Quy tắc tuần (chốt 2026-11-25):
//   - Mỗi tuần đúng 7 ngày T2 → CN, không gộp, không cắt theo tháng. Tuần vắt 2 tháng thuộc tháng chứa Thứ 5
//     (T11/2026: tuần cuối = 23–29/11; 30/11–6/12 là tuần đầu T12).
//   - Sếp nói tháng có N tuần mà tháng có nhiều tuần hơn (T12/2026 có 5 tuần, sếp nói "3 tuần"): lấy N tuần đầu,
//     "tuần cuối" = tuần thứ N, card cảnh báo các tuần còn lại chưa có mục tiêu để người xác nhận sửa nếu sai.
//   - Khác Báo cáo tuần (weekly-report-periods: CN → T7, cắt theo tháng).

import { addDaysIso, daysInMonthOf } from "./weekly-report-periods";

export type TargetKind = "week_total" | "daily_rate" | "month_total" | "margin_floor";
export type TargetMetric = "units" | "revenue" | "profit" | "margin";

/** Một mục tiêu AI bóc từ tin nhắn (chưa có ngày cụ thể). */
export interface ExtractedTarget {
  kind?: string;
  metric?: string;
  value?: number | string;
  month?: string | null;
  /** "first" | "middle" | "last" | 1..n | "W50" | "this" | "next" */
  week_ref?: string | number | null;
  weeks_in_plan?: number | null;
  /** Ngày ghi thẳng trong tin ("1–10/12"), ưu tiên hơn week_ref. */
  start_date?: string | null;
  end_date?: string | null;
  /** month_total: "còn thực hiện X" = phần còn lại từ ngày nhắn tới hết tháng. */
  remaining?: boolean | null;
  store?: string | null;
  comparator?: string | null;
  is_estimate?: boolean | null;
  quote?: string | null;
}

export interface ExtractedMessage {
  team?: string | null;
  targets?: ExtractedTarget[];
  context?: string[];
  warnings?: string[];
}

/** Một mục tiêu đã đổi ra khoảng ngày, sẵn sàng lưu. */
export interface TeamTargetItem {
  kind: TargetKind;
  metric: TargetMetric;
  value: number;
  startDate: string;
  /** null: áp dụng tới khi có mức mới (margin tối thiểu). */
  endDate: string | null;
  storeName: string | null;
  comparator: ">=" | "=";
  isEstimate: boolean;
  label: string;
  quote: string | null;
  /** Giả định code đã dùng khi đổi ra ngày (hiện trên card để người xác nhận kiểm tra). */
  note: string | null;
}

export interface NormalizedTargets {
  team: string | null;
  items: TeamTargetItem[];
  context: string[];
  warnings: string[];
}

export interface WeekBlock {
  startDate: string;
  endDate: string;
  days: number;
  /** Số tuần W (như báo cáo tuần) nằm trong khối. */
  weeks: number[];
}

const KINDS: TargetKind[] = ["week_total", "daily_rate", "month_total", "margin_floor"];
const METRICS: TargetMetric[] = ["units", "revenue", "profit", "margin"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const daysBetween = (start: string, end: string) => dayDiff(start, end) + 1;
const monthEndOf = (month: string) => `${month}-${String(daysInMonthOf(month)).padStart(2, "0")}`;
export const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const dm = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
export const rangeLabel = (start: string, end: string | null) => {
  if (!end) return `từ ${dm(start)}`;
  if (start === end) return dm(start);
  return start.slice(5, 7) === end.slice(5, 7) ? `${Number(start.slice(8, 10))}–${dm(end)}` : `${dm(start)}–${dm(end)}`;
};
const monthShort = (month: string) => `T${Number(month.slice(5, 7))}`;

/** Thứ 2 của tuần chứa `date`. */
function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = CN
  return addDaysIso(date, -((dow + 6) % 7));
}

/** Số tuần ISO 8601 (tuần T2 → CN, tuần 1 chứa Thứ 5 đầu tiên của năm). */
export function isoWeekNumber(date: string): number {
  const thursday = addDaysIso(mondayOf(date), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(dayDiff(jan1, thursday) / 7) + 1;
}

/**
 * Các tuần của tháng: mỗi tuần đúng 7 ngày T2 → CN, không cắt theo tháng. Tuần vắt 2 tháng thuộc tháng chứa
 * Thứ 5 của tuần (tháng có ≥ 4 ngày): T11/2026 = 2–8 · 9–15 · 16–22 · 23–29; T12/2026 = 30/11–6/12 · … · 28/12–3/1.
 */
export function monthWeekBlocks(month: string): WeekBlock[] {
  const blocks: WeekBlock[] = [];
  let monday = mondayOf(`${month}-01`);
  if (addDaysIso(monday, 3).slice(0, 7) < month) monday = addDaysIso(monday, 7);
  while (addDaysIso(monday, 3).slice(0, 7) === month) {
    blocks.push({ startDate: monday, endDate: addDaysIso(monday, 6), days: 7, weeks: [isoWeekNumber(monday)] });
    monday = addDaysIso(monday, 7);
  }
  return blocks;
}

/** Tháng mà tuần chứa `date` thuộc về (tháng của Thứ 5). */
const weekMonthOf = (date: string) => addDaysIso(mondayOf(date), 3).slice(0, 7);

const ORDINAL_WORDS: Record<string, string> = {
  first: "first", "đầu": "first", dau: "first", "đầu tiên": "first",
  middle: "middle", "giữa": "middle", giua: "middle",
  last: "last", "cuối": "last", cuoi: "last", "cuối cùng": "last",
  this: "this", "này": "this", "hiện tại": "this", current: "this",
  next: "next", sau: "next", "tới": "next", "tuần sau": "next", "tuần tới": "next",
};

interface ResolvedRange {
  startDate: string;
  endDate: string;
  label: string;
  note: string | null;
}

/**
 * Đổi vị trí tuần ("first" / "middle" / "last" / số thứ tự / "W50" / "this" / "next") trong tháng ra 1 tuần 7 ngày.
 * `weeksInPlan`: số tuần sếp nói cho tháng đó ("3 tuần tháng 12"); ít hơn số tuần của tháng thì lấy N tuần đầu
 * ("tuần cuối" = tuần thứ N).
 */
export function resolveWeekRef(
  month: string,
  ref: string | number,
  weeksInPlan: number | null | undefined,
  sentDate: string,
): ResolvedRange | { error: string } {
  const raw = String(ref).trim().toLowerCase();
  const word = ORDINAL_WORDS[raw] ?? raw;
  const week = (start: string) => ({ startDate: start, endDate: addDaysIso(start, 6) });

  if (word === "this" || word === "next") {
    // Nhãn theo vị trí trong tháng ("Tuần 1 T12") để báo cáo các ngày sau vẫn rõ là tuần nào
    const monday = addDaysIso(mondayOf(sentDate), word === "next" ? 7 : 0);
    const m = weekMonthOf(monday);
    const k = monthWeekBlocks(m).findIndex((b) => b.startDate === monday) + 1;
    return { ...week(monday), label: `Tuần ${k} ${monthShort(m)}`, note: word === "this" ? "tuần này" : "tuần sau" };
  }

  const blocks = monthWeekBlocks(month);
  const wMatch = raw.match(/^w\s*(\d{1,2})$/);
  if (wMatch) {
    const w = Number(wMatch[1]);
    const b = blocks.find((x) => x.weeks.includes(w));
    if (!b) return { error: `W${w} không thuộc ${monthShort(month)}.` };
    return { ...week(b.startDate), label: `W${w} ${monthShort(month)}`, note: null };
  }

  const plan = weeksInPlan && weeksInPlan > 0 && weeksInPlan < blocks.length ? weeksInPlan : null;
  const n = plan ?? blocks.length;
  const numMatch = raw.match(/^(?:tuần\s*|tuan\s*|week\s*)?(\d{1,2})$/);
  let index: number | null = null;
  let name = "";
  let note: string | null = null;
  if (word === "first") [index, name] = [0, "Tuần đầu"];
  else if (word === "last") [index, name] = [n - 1, "Tuần cuối"];
  else if (word === "middle") {
    [index, name] = [Math.floor((n - 1) / 2), "Tuần giữa"];
    if (n % 2 === 0) note = `${monthShort(month)} có ${n} tuần, "tuần giữa" lấy tuần thứ ${index + 1}`;
  } else if (numMatch) {
    const k = Number(numMatch[1]);
    if (k < 1 || k > blocks.length) return { error: `${monthShort(month)} chỉ có ${blocks.length} tuần, không có tuần ${k}.` };
    [index, name] = [k - 1, `Tuần ${k}`];
  }
  if (index === null || !blocks[index]) return { error: `Không hiểu vị trí tuần "${ref}".` };
  return { ...week(blocks[index].startDate), label: `${name} ${monthShort(month)}`, note };
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s$%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Mã team chuẩn ("Team 3", "fba3", "FBA 3" → "FBA 3"; "fbm" → "FBM") nếu có trong `knownTeams`. */
export function normalizeTeamName(raw: string | null | undefined, knownTeams: string[]): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const byKey = new Map(knownTeams.map((t) => [t.replace(/\s+/g, "").toUpperCase(), t]));
  const direct = byKey.get(s.replace(/\s+/g, "").toUpperCase());
  if (direct) return direct;
  if (/^fbm$/i.test(s.replace(/^team\s*/i, ""))) return byKey.get("FBM") ?? null;
  const n = s.match(/^(?:team|fba)\s*(\d+)$/i);
  return n ? byKey.get(`FBA${n[1]}`) ?? null : null;
}

/** Team nhắc thẳng trong tin ("team 3", "FBA 2", "team FBM"). */
export function teamMentionedInText(text: string, knownTeams: string[]): string | null {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:team|fba)\s*(\d)\b/gi)) {
    const t = normalizeTeamName(`FBA ${m[1]}`, knownTeams);
    if (t) found.add(t);
  }
  if (/\bteam\s*fbm\b/i.test(text)) {
    const t = normalizeTeamName("FBM", knownTeams);
    if (t) found.add(t);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Lọc nhanh trước khi gọi AI: tin có nhắc tuần/tháng/ngày + con số + chỉ số (units, $, margin...) và không phải câu hỏi.
 */
export function looksLikeTargetMessage(text: string): boolean {
  const t = text.toLowerCase();
  if (/\?\s*$/.test(t) || /\bbao nhiêu\b|\bbao nhieu\b|\bthế nào\b|\bra sao\b/.test(t)) return false;
  if (!/\d/.test(t)) return false;
  const period = /tuần|tuan|\bweek\b|\bw\d{1,2}\b|tháng|thang|mỗi ngày|moi ngay|\/ngày|\/ngay/.test(t);
  const metric = /unit|\bsale|doanh thu|revenue|profit|lợi nhuận|loi nhuan|margin|\$\s*\d|\d\s*k\b/.test(t);
  const intent = /mục tiêu|muc tieu|target|kpi|cần|can day|đẩy|day|tối thiểu|toi thieu|dự kiến|du kien|còn|con thuc hien|cap/.test(t);
  return period && metric && (intent || /tuần\s*(?:đầu|giữa|cuối|\d)|tuan\s*(?:dau|giua|cuoi|\d)/.test(t));
}

/** Bỏ ```json … ``` và lấy khối JSON đầu tiên trong câu trả lời của AI. */
export function parseAiJson(content: string): ExtractedMessage | null {
  const body = content.replace(/```(?:json)?/gi, "").trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as ExtractedMessage) : null;
  } catch {
    return null;
  }
}

/** "3 tuần tháng 12", "3 tuần. tháng 12", "tháng 12 chia 3 tuần" → {"2026-12" → 3} (tháng < tháng nhắn thì sang năm sau). */
export function plansFromText(text: string, sentDate: string): Map<string, number> {
  const out = new Map<string, number>();
  const year = Number(sentDate.slice(0, 4));
  const sentM = Number(sentDate.slice(5, 7));
  const put = (weeks: string, month: string) => {
    const m = Number(month);
    const w = Number(weeks);
    if (m < 1 || m > 12 || w < 1 || w > 6) return;
    const key = `${m < sentM ? year + 1 : year}-${String(m).padStart(2, "0")}`;
    if (!out.has(key)) out.set(key, w);
  };
  const t = text.toLowerCase();
  for (const x of t.matchAll(/(\d)\s*(?:tuần|tuan)[\s.,:;-]{0,4}(?:của\s*|cua\s*|cho\s*|trong\s*)?(?:tháng|thang|t)\s*(\d{1,2})\b/g)) put(x[1], x[2]);
  for (const x of t.matchAll(/(?:tháng|thang)\s*(\d{1,2})\b[^\d]{0,15}?(\d)\s*(?:tuần|tuan)/g)) put(x[2], x[1]);
  return out;
}

const KIND_LABEL: Record<TargetKind, string> = {
  week_total: "",
  daily_rate: "Mỗi ngày",
  month_total: "Tổng",
  margin_floor: "Margin tối thiểu",
};

/**
 * Đổi kết quả AI ra các mục tiêu có khoảng ngày; kèm cảnh báo (không đổi được ngày, tổng tuần ≠ tổng tháng,
 * mỗi ngày × số ngày ≠ tổng tuần, store không thuộc team).
 */
export function normalizeExtraction(
  raw: ExtractedMessage,
  options: {
    sentDate: string;
    knownTeams: string[];
    /** Tên store (in hoa) → các team quản lý. */
    storeTeams: Map<string, string[]>;
    /** Tin gốc: team ("team 3") và số tuần ("3 tuần tháng 12") chỉ lấy từ câu chữ, không tin AI. */
    text?: string;
  },
): NormalizedTargets {
  const { sentDate, knownTeams, storeTeams } = options;
  const warnings: string[] = (raw.warnings ?? []).filter((w) => typeof w === "string" && w.trim());
  const items: TeamTargetItem[] = [];
  const sentMonth = sentDate.slice(0, 7);

  // "N tuần" của 1 tháng CHỈ lấy từ câu chữ ("3 tuần. tháng 12"): AI có lúc quên, có lúc gán nhầm cho tháng khác
  // (2026-11-25: gán "3 tuần" cho cả T11 → "tuần cuối T11" thành 16–22/11)
  const planByMonth = plansFromText(options.text ?? "", sentDate);

  for (const t0 of raw.targets ?? []) {
    const m0 = t0.month && MONTH.test(t0.month) ? t0.month : sentMonth;
    const t = { ...t0, weeks_in_plan: planByMonth.get(m0) ?? null };
    const kind = KINDS.find((k) => k === t.kind);
    const metric = METRICS.find((m) => m === t.metric) ?? (kind === "margin_floor" ? "margin" : undefined);
    const value = num(t.value);
    if (!kind || !metric || value === null || value <= 0) {
      if (t.quote) warnings.push(`Bỏ qua "${t.quote}": không rõ loại mục tiêu hoặc con số.`);
      continue;
    }
    const month = t.month && MONTH.test(t.month) ? t.month : sentMonth;
    const store = t.store?.trim() ? t.store.trim().toUpperCase() : null;
    if (store && !storeTeams.has(store)) warnings.push(`Không tìm thấy store "${t.store}" trên trang Stores.`);
    const comparator = t.comparator === "=" ? "=" : ">=";
    const base = {
      kind,
      metric: kind === "margin_floor" ? ("margin" as const) : metric,
      value,
      storeName: store,
      comparator,
      isEstimate: Boolean(t.is_estimate),
      quote: t.quote?.trim() || null,
    } satisfies Partial<TeamTargetItem>;

    // Ngày ghi thẳng trong tin
    if (t.start_date && ISO.test(t.start_date)) {
      const end = t.end_date && ISO.test(t.end_date) ? t.end_date : kind === "margin_floor" ? null : monthEndOf(t.start_date.slice(0, 7));
      if (end && end < t.start_date) {
        warnings.push(`Bỏ qua "${t.quote ?? value}": ngày kết thúc trước ngày bắt đầu.`);
        continue;
      }
      items.push({ ...base, startDate: t.start_date, endDate: end, label: `${KIND_LABEL[kind] || "Mục tiêu"} ${rangeLabel(t.start_date, end)}`.trim(), note: null });
      continue;
    }

    const hasWeekRef = t.week_ref !== null && t.week_ref !== undefined && String(t.week_ref).trim() !== "";
    if (kind === "month_total") {
      const start = t.remaining && month === sentMonth ? sentDate : `${month}-01`;
      const end = monthEndOf(month);
      items.push({
        ...base,
        startDate: start,
        endDate: end,
        label: t.remaining ? `Còn lại ${monthShort(month)}` : `Tổng ${monthShort(month)}`,
        note: t.remaining ? `phần còn lại tính từ ngày nhắn ${ddmm(sentDate)}` : null,
      });
      continue;
    }
    if (hasWeekRef) {
      const r = resolveWeekRef(month, t.week_ref!, t.weeks_in_plan, sentDate);
      if ("error" in r) {
        warnings.push(`Bỏ qua "${t.quote ?? value}": ${r.error}`);
        continue;
      }
      const label = kind === "week_total" ? r.label : `${KIND_LABEL[kind]}${store ? ` ${store}` : ""} (${r.label})`;
      items.push({ ...base, startDate: r.startDate, endDate: kind === "margin_floor" ? null : r.endDate, label, note: r.note });
      continue;
    }
    if (kind === "week_total") {
      warnings.push(`Bỏ qua "${t.quote ?? value}": không rõ tuần nào.`);
      continue;
    }
    // Mỗi ngày / margin tối thiểu không gắn tuần: áp dụng từ ngày nhắn (margin tới khi có mức mới, mỗi ngày tới hết tháng)
    items.push({
      ...base,
      startDate: sentDate,
      endDate: kind === "margin_floor" ? null : monthEndOf(sentMonth),
      label: `${KIND_LABEL[kind]}${store ? ` ${store}` : ""}`,
      note: kind === "margin_floor" ? "áp dụng từ ngày nhắn tới khi có mức mới" : `áp dụng từ ${ddmm(sentDate)} tới hết ${monthShort(sentMonth)}`,
    });
  }

  // Margin tối thiểu: không gắn ngày kết thúc (áp dụng tới khi có mức mới)
  for (const it of items) {
    if (it.kind === "margin_floor" && it.endDate === null && !it.note) it.note = "áp dụng tới khi có mức mới";
  }

  // Team CHỈ lấy khi tin ghi rõ ("team 3", "FBA 2"); không đoán theo store hay nhóm chat — không rõ thì card hỏi team
  const team = options.text ? teamMentionedInText(options.text, knownTeams) : null;
  if (team) {
    for (const it of items) {
      const teams = it.storeName ? storeTeams.get(it.storeName) : undefined;
      if (teams && !teams.includes(team)) warnings.push(`Store ${it.storeName} không thuộc ${team} (trang Stores ghi ${teams.join(", ")}).`);
    }
  }

  // Kiểm tra chéo: tổng các tuần = tổng tháng; mỗi ngày × số ngày ≈ tổng tuần
  const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
  for (const mt of items.filter((x) => x.kind === "month_total" && x.startDate.endsWith("-01"))) {
    const weeks = items.filter((x) => x.kind === "week_total" && x.metric === mt.metric && !x.storeName && weekMonthOf(x.startDate) === mt.startDate.slice(0, 7));
    if (weeks.length >= 2) {
      const sum = weeks.reduce((s, x) => s + x.value, 0);
      if (Math.abs(sum - mt.value) > mt.value * 0.01) {
        warnings.push(`Các tuần ${monthShort(mt.startDate.slice(0, 7))} cộng lại ${fmt(sum)} ≠ tổng tháng ${fmt(mt.value)}.`);
      }
    }
  }
  // Sếp nói N tuần mà tháng có nhiều tuần hơn: đã lấy N tuần đầu → báo các tuần còn lại chưa có mục tiêu
  for (const [month, plan] of planByMonth) {
    const blocks = monthWeekBlocks(month);
    const hasWeeks = items.some((x) => x.kind === "week_total" && weekMonthOf(x.startDate) === month);
    if (!hasWeeks || plan >= blocks.length) continue;
    const rest = blocks.slice(plan).map((b) => rangeLabel(b.startDate, b.endDate)).join(", ");
    warnings.push(`${monthShort(month)} có ${blocks.length} tuần (T2–CN), tin nói ${plan} tuần → lấy ${plan} tuần đầu; tuần ${rest} chưa có mục tiêu tuần.`);
  }
  for (const dr of items.filter((x) => x.kind === "daily_rate" && x.endDate)) {
    const wk = items.find((x) => x.kind === "week_total" && x.metric === dr.metric && x.storeName === dr.storeName && x.startDate === dr.startDate && x.endDate === dr.endDate);
    if (!wk) continue;
    const days = daysBetween(dr.startDate, dr.endDate!);
    const implied = dr.value * days;
    if (Math.abs(implied - wk.value) > wk.value * 0.1) {
      warnings.push(`${fmt(dr.value)}/ngày × ${days} ngày (${rangeLabel(dr.startDate, dr.endDate)}) = ${fmt(implied)}, khác mục tiêu tuần ${fmt(wk.value)}.`);
    }
  }

  // Sắp cho dễ đọc: theo tháng (tuần vắt 2 tháng tính tháng chứa Thứ 5), trong tháng các tuần theo ngày rồi tới dòng
  // tổng / còn lại của tháng; margin tối thiểu xuống cuối. Sếp có thể viết "tuần cuối" trước "tuần đầu".
  const monthKey = (x: TeamTargetItem) =>
    x.kind === "margin_floor" ? "9999-99" : x.kind === "month_total" ? x.startDate.slice(0, 7) : weekMonthOf(x.startDate);
  const kindOrder: Record<TargetKind, number> = { week_total: 0, daily_rate: 1, month_total: 2, margin_floor: 3 };
  items.sort((a, b) =>
    monthKey(a).localeCompare(monthKey(b)) ||
    (a.kind === "month_total" ? 1 : 0) - (b.kind === "month_total" ? 1 : 0) ||
    a.startDate.localeCompare(b.startDate) ||
    kindOrder[a.kind] - kindOrder[b.kind]);

  return {
    team,
    items,
    context: (raw.context ?? []).filter((c) => typeof c === "string" && c.trim()),
    warnings: [...new Set(warnings)],
  };
}

// ───────────────────────── Tiến độ trong báo cáo ngày ─────────────────────────

export interface ActiveTeamTarget {
  kind: TargetKind;
  metric: TargetMetric;
  value: number;
  startDate: string;
  endDate: string | null;
  storeName: string | null;
  comparator: ">=" | "=";
  isEstimate: boolean;
  label: string;
}

export interface PeriodTotals {
  quantity: number;
  revenue: number;
  profit: number;
}

/** Tổng số liệu của team (hoặc 1 store của team khi storeName có) trong [from, to]. */
export type TeamTotalsFn = (from: string, to: string, storeName: string | null) => PeriodTotals;

const metricValue = (m: TargetMetric, t: PeriodTotals) =>
  m === "units" ? t.quantity : m === "revenue" ? t.revenue : m === "profit" ? t.profit : t.revenue > 0 ? (t.profit / t.revenue) * 100 : NaN;

const fmtMetric = (m: TargetMetric, v: number) => {
  if (m === "margin") return Number.isFinite(v) ? `${v.toFixed(1)}%` : "—";
  const s = Math.round(Math.abs(v)).toLocaleString("en-US");
  return m === "units" ? `${v < 0 ? "-" : ""}${s}` : `${v < 0 ? "-" : ""}$${s}`;
};
const unit = (m: TargetMetric) => (m === "units" ? " units" : "");
const green = (s: string) => `<font color='green'>${s}</font>`;
const red = (s: string) => `<font color='red'>${s}</font>`;
const orange = (s: string) => `<font color='orange'>${s}</font>`;
const grey = (s: string) => `<font color='grey'>${s}</font>`;

/** Mục tiêu đang áp dụng ở ngày báo cáo. */
export const isTargetActiveOn = (t: { startDate: string; endDate: string | null }, date: string) =>
  t.startDate <= date && (t.endDate === null || date <= t.endDate);

/** 1 dòng markdown tiến độ của 1 mục tiêu tại ngày báo cáo `date` (số đã chốt tới hết ngày đó). */
export function targetProgressLine(t: ActiveTeamTarget, date: string, totals: TeamTotalsFn, compact = false): string {
  const est = t.isEstimate ? grey(" (dự kiến)") : "";
  const goal = `${t.comparator === ">=" ? "≥" : ""}${fmtMetric(t.metric, t.value)}${unit(t.metric)}`;

  if (t.kind === "margin_floor") {
    const today = metricValue("margin", totals(date, date, t.storeName));
    const since = metricValue("margin", totals(t.startDate, date, t.storeName));
    const mark = (v: number) => (!Number.isFinite(v) ? grey("—") : v >= t.value ? green(`${v.toFixed(1)}% ✅`) : red(`${v.toFixed(1)}% ❌`));
    const who = t.storeName ? `**${t.storeName}**` : "team";
    return `🧱 Margin tối thiểu ${who} ≥${t.value}%: hôm nay ${mark(today)} · từ ${ddmm(t.startDate)} ${mark(since)}`;
  }

  if (t.kind === "daily_rate") {
    const today = metricValue(t.metric, totals(date, date, t.storeName));
    const elapsed = daysBetween(t.startDate, date);
    const avg = metricValue(t.metric, totals(t.startDate, date, t.storeName)) / elapsed;
    const ok = today >= t.value;
    const scope = t.storeName ? ` ${t.storeName}` : "";
    return `📆 Mỗi ngày${scope} ${goal}${est}: hôm nay ${ok ? green(`${fmtMetric(t.metric, today)} ✅`) : red(`${fmtMetric(t.metric, today)} ❌`)}${elapsed > 1 ? ` · TB từ ${ddmm(t.startDate)} ${fmtMetric(t.metric, avg)}/ngày` : ""}`;
  }

  // Tổng tuần / tổng tháng: lũy kế, % đạt, tiến độ theo ngày, cần bao nhiêu/ngày cho số ngày còn lại
  const end = t.endDate ?? date;
  const days = daysBetween(t.startDate, end);
  const elapsed = Math.min(days, daysBetween(t.startDate, date));
  const actual = metricValue(t.metric, totals(t.startDate, date, t.storeName));
  const pct = t.value > 0 ? (actual / t.value) * 100 : 0;
  // compact: lũy kế / target / % đã có ở cột bảng → chỉ còn ngày thứ mấy, tiến độ, cần bao nhiêu/ngày
  const name = t.storeName && !t.label.toUpperCase().includes(t.storeName) ? `${t.label} · ${t.storeName}` : t.label;
  const head = compact
    ? `🎯 **${name} (${rangeLabel(t.startDate, t.endDate)})**: ngày ${elapsed}/${days}`
    : `🎯 **${name} (${rangeLabel(t.startDate, t.endDate)})**: **${fmtMetric(t.metric, actual)} / ${goal}**${est} · **${pct.toFixed(0)}%** · ngày ${elapsed}/${days}`;
  if (date >= end) {
    return `${head} · ${actual >= t.value ? green("✅ ĐẠT") : red(`❌ KHÔNG ĐẠT (thiếu ${fmtMetric(t.metric, t.value - actual)}${unit(t.metric)})`)}`;
  }
  const left = days - elapsed;
  const pace = (t.value * elapsed) / days;
  const need = Math.max(0, (t.value - actual) / left);
  const status = actual >= t.value
    ? green("✅ đã đạt")
    : actual >= pace
      ? green("đúng tiến độ")
      : actual >= pace * 0.9
        ? orange(`⚠️ chậm ${fmtMetric(t.metric, pace - actual)}${unit(t.metric)} so với tiến độ`)
        : red(`❌ chậm ${fmtMetric(t.metric, pace - actual)}${unit(t.metric)} so với tiến độ`);
  return `${head} · ${status}${actual < t.value ? ` · cần ~${fmtMetric(t.metric, need)}${unit(t.metric)}/ngày trong ${left} ngày còn lại` : ""}`;
}

/** Target tuần tính Units, hiện thành cột "Target tuần" / "% đạt tuần" ngay sau Units trong bảng team. */
export const isWeekUnitsTarget = (t: ActiveTeamTarget) => t.kind === "week_total" && t.metric === "units";

/**
 * 3 ô "Lũy kế tuần" / "Target tuần" / "% đạt" của 1 hàng bảng team (storeName null = hàng Tổng team), chữ thường,
 * không tô màu / đánh giá. Tuần lấy theo target tuần (Units) đang chạy của team; hàng không có target riêng vẫn có
 * lũy kế, Target / % để "—". Không có target tuần nào → null.
 */
export function weekTargetCells(
  targets: ActiveTeamTarget[],
  date: string,
  totals: TeamTotalsFn,
  storeName: string | null,
): { cum: string; target: string; pct: string; week: string } | null {
  const active = targets.filter((x) => isWeekUnitsTarget(x) && isTargetActiveOn(x, date) && x.endDate);
  if (!active.length) return null;
  const own = active.find((x) => x.storeName === storeName);
  const week = own ?? active.find((x) => x.storeName === null) ?? active[0];
  const cum = totals(week.startDate, date, storeName).quantity;
  return {
    cum: fmtMetric("units", cum),
    target: own ? fmtMetric("units", own.value) : "—",
    pct: own && own.value > 0 ? `${((cum / own.value) * 100).toFixed(1)}%` : "—",
    week: rangeLabel(week.startDate, week.endDate),
  };
}

/**
 * Khối "Mục tiêu sếp giao" của 1 team trong báo cáo ngày; rỗng khi không có mục tiêu đang áp dụng.
 * `weekUnitsInTable`: target tuần (Units) đã hiện ở cột bảng → dòng của nó chỉ còn tiến độ / cần bao nhiêu mỗi ngày.
 */
export function teamTargetsBlock(targets: ActiveTeamTarget[], date: string, totals: TeamTotalsFn, weekUnitsInTable = false): string {
  const active = targets.filter((t) => isTargetActiveOn(t, date));
  if (!active.length) return "";
  const order: Record<TargetKind, number> = { week_total: 0, daily_rate: 1, month_total: 2, margin_floor: 3 };
  const lines = [...active]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.startDate.localeCompare(b.startDate))
    .map((t) => targetProgressLine(t, date, totals, weekUnitsInTable && isWeekUnitsTarget(t)));
  return ["**🎯 Mục tiêu team** " + grey("(số đã chốt tới hết ngày báo cáo)"), ...lines].join("\n");
}

// ───────────────────────── Xem / xoá mục tiêu, nhập từ web ─────────────────────────

export const TARGET_KINDS = KINDS;
export const TARGET_METRICS = METRICS;

/** Tên mục tiêu nhập từ web: tuần trùng 1 tuần của tháng → "Tuần 2 T12"; còn lại theo khoảng ngày. */
export function defaultTargetLabel(kind: TargetKind, startDate: string, endDate: string | null, storeName: string | null): string {
  const store = storeName ? ` ${storeName}` : "";
  if (kind === "margin_floor") return `Margin tối thiểu${store}`;
  if (kind === "month_total" && endDate && startDate.endsWith("-01") && endDate === monthEndOf(startDate.slice(0, 7))) {
    return `Tổng ${monthShort(startDate.slice(0, 7))}${store}`;
  }
  const m = weekMonthOf(startDate);
  const k = monthWeekBlocks(m).findIndex((b) => b.startDate === startDate && b.endDate === endDate);
  const week = k >= 0 ? `Tuần ${k + 1} ${monthShort(m)}` : null;
  if (kind === "week_total") return `${week ?? `Mục tiêu ${rangeLabel(startDate, endDate)}`}${store}`;
  if (kind === "daily_rate") return `Mỗi ngày${store}${week ? ` (${week})` : ""}`;
  return `Tổng ${rangeLabel(startDate, endDate)}${store}`;
}

export interface TargetListCommand {
  /** true: "xoá / bỏ / huỷ mục tiêu"; false: "xem mục tiêu". */
  remove: boolean;
  /** Lọc theo tuần nhắc trong tin ("tuần 2", "tuần cuối tháng 12", "tuần này"). */
  range: { startDate: string; endDate: string; label: string } | null;
  team: string | null;
}

/**
 * "xoá mục tiêu", "bỏ target tuần 2", "huỷ mục tiêu tuần cuối tháng 12 team 3", "xem mục tiêu" → lệnh; tin khác → null.
 */
export function parseTargetListCommand(text: string, today: string, knownTeams: string[]): TargetListCommand | null {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const noun = String.raw`(?:target|mục tiêu|muc tieu|kpi tuần|kpi tuan)`;
  const remove = new RegExp(String.raw`(?:xoá|xóa|xoa|bỏ|bo|huỷ|hủy|huy|gỡ|go)\s+(?:hết\s+|het\s+|các\s+|cac\s+)?${noun}`).test(t);
  const list = new RegExp(String.raw`(?:xem|danh sách|danh sach|list|liệt kê|liet ke)\s+(?:các\s+|cac\s+)?${noun}`).test(t);
  if (!remove && !list) return null;

  let range: TargetListCommand["range"] = null;
  const w = t.match(/tuần\s*(đầu|giữa|cuối|này|sau|tới|\d{1,2})|tuan\s*(dau|giua|cuoi|nay|sau|toi|\d{1,2})/);
  if (w) {
    const ref = w[1] ?? w[2];
    const mm = t.match(/(?:tháng|thang|\bt)\s*(\d{1,2})\b/);
    let month = weekMonthOf(today);
    if (mm) {
      const m = Number(mm[1]);
      const y = Number(today.slice(0, 4)) + (m < Number(today.slice(5, 7)) - 6 ? 1 : 0);
      month = `${y}-${String(m).padStart(2, "0")}`;
    }
    const r = resolveWeekRef(month, ref, null, today);
    if (!("error" in r)) range = { startDate: r.startDate, endDate: r.endDate, label: r.label };
  }
  return { remove, range, team: teamMentionedInText(t, knownTeams) };
}
