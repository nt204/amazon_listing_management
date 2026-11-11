// Lịch sử Auto Bid của từng target → hành động hiện tại.
//
// Mỗi target có một chuỗi lần chỉnh bid. Mỗi lần chỉnh được chấm ở các mốc
// 3/7/14/30 ngày. Hành động hiện tại suy ra từ lần chỉnh gần nhất, có tham
// chiếu cả lịch sử (bid tốt nhất từng đạt được) để biết nên quay về đâu.

export type WindowDays = 3 | 7 | 14 | 30;
export const WINDOW_DAYS: WindowDays[] = [3, 7, 14, 30];

export interface HistoryWindowInput {
  status: string;
  outcome_label: string | null;
  baseline: Record<string, unknown>;
  observed: Record<string, unknown>;
  comparison: { reward_usd?: number | null };
  evidence_quality: { validity?: string | null };
}

export interface HistoryActionInput {
  action_id: string;
  campaign_id: string;
  campaign_name: string;
  target_id: string;
  target_keyword: string;
  match_type: string;
  sku: string;
  old_value: string | number;
  system_suggested_value: string | number;
  final_value: string | number;
  applied_delta_pct: number;
  applied_on: string;
  action_timestamp?: string | null;
  baseline: Record<string, unknown>;
  d3: HistoryWindowInput | null;
  d7: HistoryWindowInput | null;
  d14: HistoryWindowInput | null;
  d30: HistoryWindowInput | null;
  /** Bid Amazon đang chạy theo báo cáo mới nhất và ngày cuối của báo cáo đó. */
  current?: { bid: number | null; asOf: string | null } | null;
}

export type WindowState = "WIN" | "LOSS" | "NEUTRAL" | "LOW_DATA" | "WAITING" | "OVERDUE" | "INTERRUPTED";

export interface WindowMetrics {
  spendBefore: number;
  spendAfter: number;
  salesBefore: number;
  salesAfter: number;
  ordersBefore: number;
  ordersAfter: number;
  acosBefore: number | null;
  acosAfter: number | null;
}

export interface WindowResult {
  days: WindowDays;
  state: WindowState;
  dueDate: string;
  reward: number | null;
  metrics: WindowMetrics | null;
}

export interface ChangeStep<T extends HistoryActionInput = HistoryActionInput> {
  action: T;
  date: string;
  oldBid: number;
  newBid: number;
  deltaPct: number;
  daysElapsed: number;
  windows: Record<WindowDays, WindowResult>;
  /** Mốc dài nhất đã có kết luận (Win/Loss/Bình thường/Ít dữ liệu). */
  verdict: WindowResult | null;
  /** Trạng thái tóm tắt của lần chỉnh: kết luận nếu có, nếu không là mốc đang chờ / thiếu báo cáo / bị ngắt. */
  summary: WindowResult;
}

export type ActionKind = "REVERT" | "NOT_APPLIED" | "WATCH" | "MISSING_DATA" | "SCALE" | "KEEP" | "WAIT";

export interface CurrentAction {
  kind: ActionKind;
  title: string;
  reason: string;
  targetBid: number | null;
}

export interface TargetHistory<T extends HistoryActionInput = HistoryActionInput> {
  key: string;
  keyword: string;
  matchType: string;
  campaignId: string;
  campaignName: string;
  sku: string;
  steps: ChangeStep<T>[];
  latest: ChangeStep<T>;
  currentBid: number;
  bestStep: ChangeStep<T> | null;
  action: CurrentAction;
}

export const ACTION_ORDER: ActionKind[] = ["REVERT", "NOT_APPLIED", "WATCH", "MISSING_DATA", "SCALE", "KEEP", "WAIT"];

export const ACTION_META: Record<ActionKind, { label: string; hint: string }> = {
  REVERT: { label: "Cần hoàn bid", hint: "Lần chỉnh gần nhất làm kết quả xấu đi" },
  NOT_APPLIED: { label: "Amazon chưa áp dụng", hint: "Báo cáo sau ngày chỉnh vẫn chạy bid cũ" },
  WATCH: { label: "Theo dõi sát", hint: "3 ngày đầu xấu, chờ mốc 7 ngày" },
  MISSING_DATA: { label: "Thiếu báo cáo", hint: "Đã đủ ngày nhưng chưa có báo cáo để chấm" },
  SCALE: { label: "Đang hiệu quả", hint: "Lần chỉnh gần nhất có kết quả tốt" },
  KEEP: { label: "Giữ nguyên", hint: "Không tốt không xấu, hoặc quá ít dữ liệu" },
  WAIT: { label: "Đang chờ kết quả", hint: "Chưa đủ 3 ngày từ lần chỉnh gần nhất" },
};

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function targetKeyOf(item: Pick<HistoryActionInput, "target_id" | "campaign_id" | "target_keyword" | "match_type">) {
  return item.target_id || `${item.campaign_id}_${item.target_keyword}_${item.match_type}`;
}

export function appliedDateOf(item: Pick<HistoryActionInput, "applied_on" | "action_timestamp">) {
  return (item.applied_on || item.action_timestamp || "").slice(0, 10);
}

export function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, now: Date) {
  const t = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return 0;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - t) / 86_400_000));
}

function hasObserved(window: HistoryWindowInput | null) {
  const o = window?.observed;
  return Boolean(o && (o.spend !== undefined || o.clicks !== undefined || o.orders !== undefined));
}

function isInterrupted(window: HistoryWindowInput | null) {
  return window?.status === "INTERRUPTED"
    || window?.evidence_quality?.validity === "INTERRUPTED"
    || window?.evidence_quality?.validity === "SUPERSEDED";
}

function windowMetrics(window: HistoryWindowInput, days: WindowDays, fallbackBaseline: Record<string, unknown>): WindowMetrics {
  const baseline = window.baseline && Object.keys(window.baseline).length > 0 ? window.baseline : fallbackBaseline;
  // Baseline đúng khoảng trước thì dùng nguyên; baseline 30 ngày thì quy về số ngày của mốc.
  const scale = baseline.source_method === "EXACT_PRE_WINDOW" ? 1 : days / Math.max(1, num(baseline.days || 30));
  const spendBefore = num(baseline.spend) * scale;
  const salesBefore = num(baseline.sales) * scale;
  const ordersBefore = num(baseline.orders) * scale;
  const spendAfter = num(window.observed.spend);
  const salesAfter = num(window.observed.sales);
  const ordersAfter = num(window.observed.orders);
  return {
    spendBefore,
    spendAfter,
    salesBefore,
    salesAfter,
    ordersBefore,
    ordersAfter,
    acosBefore: salesBefore > 0 ? (spendBefore / salesBefore) * 100 : null,
    acosAfter: salesAfter > 0 ? (spendAfter / salesAfter) * 100 : null,
  };
}

function decisiveState(window: HistoryWindowInput): WindowState {
  const reward = window.comparison?.reward_usd;
  const lowEvidence = window.status === "INSUFFICIENT_DATA"
    || window.outcome_label === "INCONCLUSIVE"
    || window.evidence_quality?.validity === "INCONCLUSIVE";
  if (!lowEvidence) {
    if (window.outcome_label === "POSITIVE") return "WIN";
    if (window.outcome_label === "NEGATIVE") return "LOSS";
    if (window.outcome_label === "NEUTRAL") return "NEUTRAL";
  }
  if (typeof reward === "number") {
    if (reward > 0) return "WIN";
    if (reward < 0) return "LOSS";
    return "NEUTRAL";
  }
  return "LOW_DATA";
}

export function evaluateWindow(
  window: HistoryWindowInput | null,
  days: WindowDays,
  appliedDate: string,
  daysElapsed: number,
  fallbackBaseline: Record<string, unknown>,
): WindowResult {
  const dueDate = addDaysIso(appliedDate, days);
  const base = { days, dueDate, reward: window?.comparison?.reward_usd ?? null, metrics: null };
  if (isInterrupted(window)) return { ...base, state: "INTERRUPTED" };
  if (daysElapsed < days) return { ...base, state: "WAITING" };
  if (!window || !hasObserved(window)) return { ...base, state: "OVERDUE" };
  return { ...base, state: decisiveState(window), metrics: windowMetrics(window, days, fallbackBaseline) };
}

const DECIDED: WindowState[] = ["WIN", "LOSS", "NEUTRAL", "LOW_DATA"];

export function buildStep<T extends HistoryActionInput>(action: T, now: Date): ChangeStep<T> {
  const date = appliedDateOf(action);
  const daysElapsed = date ? daysBetween(date, now) : 0;
  const oldBid = num(action.old_value);
  const newBid = num(action.final_value || action.system_suggested_value);
  const deltaPct = action.applied_delta_pct || (oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0);
  const source: Record<WindowDays, HistoryWindowInput | null> = { 3: action.d3, 7: action.d7, 14: action.d14, 30: action.d30 };
  const windows = Object.fromEntries(
    WINDOW_DAYS.map((days) => [days, evaluateWindow(source[days], days, date, daysElapsed, action.baseline || {})]),
  ) as Record<WindowDays, WindowResult>;

  const longestFirst = [...WINDOW_DAYS].reverse().map((days) => windows[days]);
  const verdict = longestFirst.find((w) => DECIDED.includes(w.state)) || null;
  const shortestFirst = WINDOW_DAYS.map((days) => windows[days]);
  const summary = verdict
    || longestFirst.find((w) => w.state === "INTERRUPTED")
    || shortestFirst.find((w) => w.state === "OVERDUE")
    || shortestFirst.find((w) => w.state === "WAITING")
    || windows[30];

  return { action, date, oldBid, newBid, deltaPct, daysElapsed, windows, verdict, summary };
}

const fmtBid = (v: number) => `$${v.toFixed(2)}`;
const fmtDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
};

function describeMetrics(w: WindowResult) {
  const m = w.metrics;
  if (!m) return "";
  const acos = m.acosBefore != null && m.acosAfter != null
    ? `ACOS ${m.acosBefore.toFixed(0)}% → ${m.acosAfter.toFixed(0)}%`
    : m.acosAfter == null && m.spendAfter > 0
      ? `tiêu $${m.spendAfter.toFixed(2)} không ra đơn`
      : "";
  const reward = w.reward != null ? `lợi nhuận ${w.reward >= 0 ? "+" : "-"}$${Math.abs(w.reward).toFixed(2)}` : "";
  return [acos, reward].filter(Boolean).join(", ");
}

/**
 * Bid Amazon đang chạy, chỉ khi báo cáo đó có sau ngày chỉnh gần nhất (báo cáo cũ hơn thì
 * chưa thể biết bid mới đã lên Amazon hay chưa).
 */
export function verifiedAmazonBid(step: ChangeStep<HistoryActionInput>): number | null {
  const cur = step.action.current;
  if (!cur || cur.bid == null || !cur.asOf || cur.asOf <= step.date) return null;
  return cur.bid;
}

export function deriveAction<T extends HistoryActionInput>(steps: ChangeStep<T>[], bestStep: ChangeStep<T> | null): CurrentAction {
  const latest = steps[steps.length - 1];
  const current = latest.newBid;
  const v = latest.verdict;
  const when = `Lần chỉnh ${fmtDate(latest.date)} (${fmtBid(latest.oldBid)} → ${fmtBid(latest.newBid)})`;

  const amazonBid = verifiedAmazonBid(latest);
  if (amazonBid != null && Math.abs(amazonBid - latest.newBid) > 0.005) {
    return {
      kind: "NOT_APPLIED",
      title: `Áp lại ${fmtBid(latest.newBid)}`,
      reason: `Báo cáo Amazon đến ${fmtDate(latest.action.current?.asOf || "")} vẫn chạy ${fmtBid(amazonBid)}: ${when.toLowerCase()} chưa được áp dụng, nên kết quả đo không phản ánh lần chỉnh này.`,
      targetBid: latest.newBid,
    };
  }

  if (v?.state === "LOSS" && v.days >= 7) {
    // Quay về bid tốt nhất từng đạt; nếu chưa có thì về bid trước lần chỉnh này.
    const target = bestStep && Math.abs(bestStep.newBid - current) > 0.005 ? bestStep.newBid : latest.oldBid;
    const source = bestStep && target === bestStep.newBid ? `bid tốt nhất trong lịch sử (${fmtDate(bestStep.date)})` : "bid trước lần chỉnh";
    return {
      kind: "REVERT",
      title: `Hoàn bid về ${fmtBid(target)}`,
      reason: `${when} cho kết quả xấu sau ${v.days} ngày: ${describeMetrics(v)}. Quay về ${source}.`,
      targetBid: target,
    };
  }
  if (v?.state === "LOSS") {
    return {
      kind: "WATCH",
      title: `Giữ ${fmtBid(current)}, xem lại ngày ${fmtDate(latest.windows[7].dueDate)}`,
      reason: `${when} xấu trong 3 ngày đầu: ${describeMetrics(v)}. 3 ngày còn nhiễu, chờ mốc 7 ngày rồi mới quyết định.`,
      targetBid: current,
    };
  }
  if (!v && latest.windows[3].state === "OVERDUE") {
    return {
      kind: "MISSING_DATA",
      title: "Đồng bộ báo cáo PPC",
      reason: `${when} đã qua ${latest.daysElapsed} ngày nhưng chưa có báo cáo sau ngày chỉnh, nên chưa chấm được.`,
      targetBid: null,
    };
  }
  if (v?.state === "WIN") {
    const up = latest.deltaPct > 0;
    const streak = steps.slice(-2).every((s) => s.verdict?.state === "WIN" && (s.deltaPct > 0) === up);
    return {
      kind: "SCALE",
      title: up ? `Giữ ${fmtBid(current)}, có thể tăng tiếp` : `Giữ bid đã giảm ${fmtBid(current)}`,
      reason: `${when} cho kết quả tốt sau ${v.days} ngày: ${describeMetrics(v)}.${streak && steps.length > 1 ? " Hai lần chỉnh liên tiếp cùng hướng đều tốt." : ""}`,
      targetBid: current,
    };
  }
  if (v) {
    return {
      kind: "KEEP",
      title: `Giữ ${fmtBid(current)}`,
      reason: v.state === "LOW_DATA"
        ? `${when}: sau ${v.days} ngày vẫn quá ít click để kết luận.`
        : `${when} không làm kết quả thay đổi đáng kể sau ${v.days} ngày${describeMetrics(v) ? `: ${describeMetrics(v)}` : ""}.`,
      targetBid: current,
    };
  }
  if (latest.summary.state === "INTERRUPTED") {
    return {
      kind: "KEEP",
      title: `Giữ ${fmtBid(current)}`,
      reason: `${when} bị một lần chỉnh sau ghi đè trước khi đo xong, nên không có kết quả riêng.`,
      targetBid: current,
    };
  }
  const next = WINDOW_DAYS.map((d) => latest.windows[d]).find((w) => w.state === "WAITING");
  return {
    kind: "WAIT",
    title: next ? `Chờ kết quả ${next.days} ngày (${fmtDate(next.dueDate)})` : "Chờ kết quả",
    reason: `${when}, đã qua ${latest.daysElapsed} ngày. Chưa nên chỉnh thêm trước khi có kết quả.`,
    targetBid: current,
  };
}

export function buildTargetHistories<T extends HistoryActionInput>(items: T[], now = new Date()): TargetHistory<T>[] {
  const byTarget = new Map<string, T[]>();
  for (const item of items) {
    const key = targetKeyOf(item);
    const list = byTarget.get(key) || [];
    list.push(item);
    byTarget.set(key, list);
  }

  const histories: TargetHistory<T>[] = [];
  for (const [key, list] of byTarget) {
    const steps: ChangeStep<T>[] = [];
    for (const step of list
      .slice()
      .sort((a, b) => (a.action_timestamp || a.applied_on || "").localeCompare(b.action_timestamp || b.applied_on || ""))
      .map((item) => buildStep(item, now))) {
      // Cùng ngày, cùng bid cũ → mới là một lần chỉnh bị ghi trùng: giữ bản sau.
      const prev = steps[steps.length - 1];
      if (prev && prev.date === step.date && Math.abs(prev.oldBid - step.oldBid) < 0.005 && Math.abs(prev.newBid - step.newBid) < 0.005) {
        steps[steps.length - 1] = step;
      } else {
        steps.push(step);
      }
    }
    const latest = steps[steps.length - 1];
    const winners = steps.filter((s) => s.verdict?.state === "WIN");
    const bestStep = winners.length
      ? winners.reduce((best, s) => ((s.verdict?.reward ?? 0) > (best.verdict?.reward ?? 0) ? s : best))
      : null;
    histories.push({
      key,
      keyword: latest.action.target_keyword,
      matchType: latest.action.match_type,
      campaignId: latest.action.campaign_id,
      campaignName: latest.action.campaign_name,
      sku: latest.action.sku,
      steps,
      latest,
      currentBid: latest.newBid,
      bestStep,
      action: deriveAction(steps, bestStep),
    });
  }
  return histories;
}
