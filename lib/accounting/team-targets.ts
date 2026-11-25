// Mục tiêu sếp giao cho team qua Lark (tag bot): "tuần cuối tháng 11 tối thiểu 3000 unit", "tuần 2: 10000 units",
// "mỗi ngày ~700", "cap margin: limima 10%". AI chỉ bóc ý (tháng, vị trí tuần, con số); code đổi ra khoảng ngày
// theo kỳ của BÁO CÁO TUẦN (weekly-report-periods: CN → T7, cắt theo tháng) để tiến độ trong báo cáo ngày
// khớp báo cáo tuần. Thuần, không truy cập DB.
//
// Quy tắc tuần:
//   - Kỳ lẻ ≤ 2 ngày ở mép tháng gộp vào tuần liền kề cùng tháng (T11/2026: 22–28 + 29–30 → "tuần cuối" 22–30, 9 ngày).
//   - Sếp nói tháng có N tuần mà tháng có nhiều kỳ hơn (T12/2026 có 5 kỳ, sếp nói "3 tuần"): chia các kỳ thành N nhóm
//     liền nhau, nhóm đầu ít kỳ nhất (5 kỳ / 3 tuần → 1–5 | 6–19 | 20–31). Card xác nhận hiện rõ ngày để sửa nếu sai.

import { addDaysIso, daysInMonthOf, weekSegmentOf, nextWeekSegment } from "./weekly-report-periods";

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

/** Các tuần của tháng theo kỳ báo cáo tuần, kỳ lẻ ≤ 2 ngày ở mép tháng gộp vào tuần liền kề. */
export function monthWeekBlocks(month: string): WeekBlock[] {
  const end = monthEndOf(month);
  const segs = [];
  let seg = weekSegmentOf(`${month}-01`);
  while (seg.startDate <= end) {
    segs.push(seg);
    seg = nextWeekSegment(seg);
  }
  const blocks: WeekBlock[] = segs.map((s) => ({ startDate: s.startDate, endDate: s.endDate, days: s.days, weeks: [s.week] }));
  const merge = (a: WeekBlock, b: WeekBlock): WeekBlock => ({
    startDate: a.startDate,
    endDate: b.endDate,
    days: a.days + b.days,
    weeks: [...a.weeks, ...b.weeks],
  });
  if (blocks.length > 1 && blocks[0].days <= 2) blocks.splice(0, 2, merge(blocks[0], blocks[1]));
  const n = blocks.length;
  if (n > 1 && blocks[n - 1].days <= 2) blocks.splice(n - 2, 2, merge(blocks[n - 2], blocks[n - 1]));
  return blocks;
}

/** Chia `blocks` thành `n` nhóm liền nhau, nhóm đầu ít kỳ nhất (5 kỳ / 3 → 1, 2, 2). */
function groupBlocks(blocks: WeekBlock[], n: number): WeekBlock[][] {
  const base = Math.floor(blocks.length / n);
  const extra = blocks.length % n;
  const groups: WeekBlock[][] = [];
  let i = 0;
  for (let g = 0; g < n; g++) {
    const size = base + (g >= n - extra ? 1 : 0);
    groups.push(blocks.slice(i, i + size));
    i += size;
  }
  return groups;
}

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
 * Đổi vị trí tuần ("first" / "middle" / "last" / số thứ tự / "W50" / "this" / "next") trong tháng ra khoảng ngày.
 * `weeksInPlan`: số tuần sếp nói cho tháng đó ("3 tuần tháng 12"), null nếu không nói.
 */
export function resolveWeekRef(
  month: string,
  ref: string | number,
  weeksInPlan: number | null | undefined,
  sentDate: string,
): ResolvedRange | { error: string } {
  const blocks = monthWeekBlocks(month);
  const raw = String(ref).trim().toLowerCase();
  const word = ORDINAL_WORDS[raw] ?? raw;
  const span = (group: WeekBlock[]) => ({
    startDate: group[0].startDate,
    endDate: group[group.length - 1].endDate,
  });
  const describe = (group: WeekBlock[]) => group.flatMap((b) => b.weeks).map((w) => `W${w}`).join(" + ");

  if (word === "this" || word === "next") {
    const sentBlocks = monthWeekBlocks(sentDate.slice(0, 7));
    let idx = sentBlocks.findIndex((b) => b.startDate <= sentDate && sentDate <= b.endDate);
    let list = sentBlocks;
    if (word === "next") {
      idx += 1;
      if (idx >= sentBlocks.length) {
        list = monthWeekBlocks(addDaysIso(monthEndOf(sentDate.slice(0, 7)), 1).slice(0, 7));
        idx = 0;
      }
    }
    const b = list[idx];
    if (!b) return { error: `Không xác định được tuần "${ref}".` };
    return { ...span([b]), label: word === "this" ? "Tuần này" : "Tuần sau", note: null };
  }

  const wMatch = raw.match(/^w\s*(\d{1,2})$/);
  if (wMatch) {
    const week = Number(wMatch[1]);
    const b = blocks.find((x) => x.weeks.includes(week));
    if (!b) return { error: `W${week} không thuộc ${monthShort(month)}.` };
    return { ...span([b]), label: `W${week} ${monthShort(month)}`, note: b.weeks.length > 1 ? `gộp ${describe([b])}` : null };
  }

  const plan = weeksInPlan && weeksInPlan > 0 && weeksInPlan < blocks.length ? weeksInPlan : null;
  const groups = plan ? groupBlocks(blocks, plan) : blocks.map((b) => [b]);
  const n = groups.length;
  const numMatch = raw.match(/^(?:tuần\s*|tuan\s*|week\s*)?(\d{1,2})$/);
  let index: number | null = null;
  let name = "";
  if (word === "first") [index, name] = [0, "Tuần đầu"];
  else if (word === "last") [index, name] = [n - 1, "Tuần cuối"];
  else if (word === "middle") {
    // Không rõ số tuần: "tuần giữa" = các tuần nằm giữa tuần đầu và tuần cuối
    if (n >= 3 && !plan && n !== 3) {
      const mid = groups.slice(1, n - 1).flat();
      return {
        ...span(mid),
        label: `Tuần giữa ${monthShort(month)}`,
        note: `"tuần giữa" lấy các tuần giữa tháng (${describe(mid)})`,
      };
    }
    [index, name] = [Math.floor((n - 1) / 2), "Tuần giữa"];
  } else if (numMatch) {
    const k = Number(numMatch[1]);
    if (k < 1 || k > n) return { error: `${monthShort(month)} chỉ có ${n} tuần, không có tuần ${k}.` };
    [index, name] = [k - 1, `Tuần ${k}`];
  }
  if (index === null || !groups[index]?.length) return { error: `Không hiểu vị trí tuần "${ref}".` };
  const group = groups[index];
  const notes: string[] = [];
  if (plan) notes.push(`${monthShort(month)} có ${blocks.length} kỳ tuần, chia thành ${plan} tuần theo tin nhắn`);
  if (group.length > 1 || group[0].weeks.length > 1) notes.push(`gộp ${describe(group)}`);
  return { ...span(group), label: `${name} ${monthShort(month)}`, note: notes.length ? notes.join("; ") : null };
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
    /** Team gắn với nhóm chat (khi tin không nhắc store/team). */
    chatTeam?: string | null;
    /** Tin gốc, để bắt "team 3" khi AI bỏ sót. */
    text?: string;
  },
): NormalizedTargets {
  const { sentDate, knownTeams, storeTeams } = options;
  const warnings: string[] = (raw.warnings ?? []).filter((w) => typeof w === "string" && w.trim());
  const items: TeamTargetItem[] = [];
  const sentMonth = sentDate.slice(0, 7);

  for (const t of raw.targets ?? []) {
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

  // Team: AI → nhắc trong tin → store trong tin → nhóm chat
  const storeTeamSet = new Set(items.flatMap((it) => (it.storeName ? storeTeams.get(it.storeName) ?? [] : [])));
  let team = normalizeTeamName(raw.team, knownTeams) ?? (options.text ? teamMentionedInText(options.text, knownTeams) : null);
  if (!team && storeTeamSet.size) {
    const fba = [...storeTeamSet].filter((x) => /^fba/i.test(x));
    const candidates = fba.length ? fba : [...storeTeamSet];
    if (new Set(candidates).size === 1) team = candidates[0];
  }
  if (!team && options.chatTeam) team = normalizeTeamName(options.chatTeam, knownTeams);
  if (team) {
    for (const it of items) {
      const teams = it.storeName ? storeTeams.get(it.storeName) : undefined;
      if (teams && !teams.includes(team)) warnings.push(`Store ${it.storeName} không thuộc ${team} (trang Stores ghi ${teams.join(", ")}).`);
    }
  }

  // Kiểm tra chéo: tổng các tuần = tổng tháng; mỗi ngày × số ngày ≈ tổng tuần
  const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
  for (const mt of items.filter((x) => x.kind === "month_total" && x.startDate.endsWith("-01"))) {
    const weeks = items.filter((x) => x.kind === "week_total" && x.metric === mt.metric && !x.storeName && x.startDate.slice(0, 7) === mt.startDate.slice(0, 7));
    if (weeks.length >= 2) {
      const sum = weeks.reduce((s, x) => s + x.value, 0);
      if (Math.abs(sum - mt.value) > mt.value * 0.01) {
        warnings.push(`Các tuần ${monthShort(mt.startDate.slice(0, 7))} cộng lại ${fmt(sum)} ≠ tổng tháng ${fmt(mt.value)}.`);
      }
      const covered = weeks.reduce((s, x) => s + daysBetween(x.startDate, x.endDate!), 0);
      const monthDays = daysInMonthOf(mt.startDate);
      if (covered < monthDays) {
        warnings.push(`Các tuần ${monthShort(mt.startDate.slice(0, 7))} chỉ phủ ${covered}/${monthDays} ngày — kiểm tra lại khoảng ngày.`);
      }
    }
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
export function targetProgressLine(t: ActiveTeamTarget, date: string, totals: TeamTotalsFn): string {
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
  const head = `🎯 **${t.label} (${rangeLabel(t.startDate, t.endDate)})**: **${fmtMetric(t.metric, actual)} / ${goal}**${est} · **${pct.toFixed(0)}%** · ngày ${elapsed}/${days}`;
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

/** Khối "Mục tiêu sếp giao" của 1 team trong báo cáo ngày; rỗng khi không có mục tiêu đang áp dụng. */
export function teamTargetsBlock(targets: ActiveTeamTarget[], date: string, totals: TeamTotalsFn): string {
  const active = targets.filter((t) => isTargetActiveOn(t, date));
  if (!active.length) return "";
  const order: Record<TargetKind, number> = { week_total: 0, daily_rate: 1, month_total: 2, margin_floor: 3 };
  const lines = [...active]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.startDate.localeCompare(b.startDate))
    .map((t) => targetProgressLine(t, date, totals));
  return ["**🎯 Mục tiêu sếp giao** " + grey("(số đã chốt tới hết ngày báo cáo)"), ...lines].join("\n");
}
