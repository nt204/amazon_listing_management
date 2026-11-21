import "server-only";

// Tool của agent đối soát kế toán: 7 tool dùng chung cho MỌI chỉ số trong danh mục (lib/metrics/accounting).
// Thêm chỉ số mới = khai báo thêm trong definitions.ts, không cần thêm tool.

import { z } from "zod";
import type { AgentTool } from "@/lib/agent-core/types";
import type { DashboardCompareMode } from "@/lib/accounting/dashboard-periods";
import { accountingMetrics, type AccountingMetricRow } from "@/lib/metrics/accounting/definitions";
import {
  loadPnlSnapshot,
  loadSkuSegments,
  resolveAccountingQuery,
  type AccountingAgentScope,
  type AccountingQuery,
  type PnlSnapshot,
} from "@/lib/metrics/accounting/source";
import { ACCOUNTING_CHECK_IDS, runAccountingChecks } from "@/lib/metrics/accounting/checks";
import { TRACEABLE_METRICS, traceAccountingSource } from "@/lib/metrics/accounting/trace";
import { breakdownMetric, compareBreakdown, compareMetric, describeMetric, explainMetric, roundFor } from "@/lib/metrics/engine";
import type { MetricDefinition, MetricSegment } from "@/lib/metrics/types";

/** Phạm vi 1 lượt chạy: quyền của người hỏi + bộ nhớ đệm snapshot (các tool gọi lại cùng phạm vi không tính lại). */
export interface AccountingRunScope extends AccountingAgentScope {
  snapshots: Map<string, Promise<PnlSnapshot>>;
}

type Tool<I> = AgentTool<AccountingRunScope, I>;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD");
const scopeFields = {
  storeNames: z
    .array(z.string().min(1).max(100))
    .max(30)
    .optional()
    .describe("Tên store (vd ['LIMIMA']). Bỏ trống = mọi store người hỏi được xem."),
  storeIds: z.array(z.string().max(64)).max(30).optional().describe("Id store (khi bối cảnh màn hình đã cho sẵn id)."),
  team: z.string().max(40).optional().describe("Lọc theo team như Dashboard, vd 'FBA 1', 'FBA 2', 'FBM'."),
  startDate: DATE.describe("Ngày đầu kỳ YYYY-MM-DD"),
  endDate: DATE.describe("Ngày cuối kỳ YYYY-MM-DD (tự cắt về ngày có dữ liệu mới nhất)"),
};
const metricField = z
  .string()
  .min(1)
  .max(60)
  .describe(`Mã chỉ số: ${accountingMetrics.list().map((m) => m.id).join(", ")} (nhận cả tên tiếng Việt).`);

function requireMetric(query: string): MetricDefinition<AccountingMetricRow> {
  const def = accountingMetrics.find(query);
  if (!def) {
    throw new Error(`Không có chỉ số "${query}". Chỉ số hợp lệ: ${accountingMetrics.list().map((m) => `${m.id} (${m.label})`).join(", ")}`);
  }
  return def;
}

function snapshot(scope: AccountingRunScope, query: AccountingQuery, compare: DashboardCompareMode = "none") {
  const resolved = resolveAccountingQuery(scope, query);
  const key = JSON.stringify([resolved, compare]);
  let promise = scope.snapshots.get(key);
  if (!promise) {
    promise = loadPnlSnapshot(scope, resolved, compare);
    scope.snapshots.set(key, promise);
    promise.catch(() => scope.snapshots.delete(key));
  }
  return promise;
}

function assertPayoutAllowed(scope: AccountingRunScope, def: MetricDefinition<AccountingMetricRow>) {
  if (def.id === "payout" && !scope.canViewPayout) throw new Error("Chỉ Admin / Kế toán được xem Payout.");
}

/**
 * Từng bước tính của 1 chỉ số, đi hết cây phụ thuộc (Margin → Profit, Revenue → Ad Spend, Base cost…):
 * mỗi bước = giá trị (nếu có dòng số liệu) + công thức + cách tính từ dữ liệu gốc theo kênh + nguồn dữ liệu.
 * Đây là phần "số này tính thế nào" để agent diễn giải cho kế toán.
 */
function calculationSteps(def: MetricDefinition<AccountingMetricRow>, channels: Set<string>, row?: AccountingMetricRow) {
  const order: string[] = [];
  const visit = (id: string) => {
    if (order.includes(id)) return;
    order.push(id);
    const m = accountingMetrics.require(id);
    if (m.kind === "derived") m.terms.forEach((t) => visit(t.metric));
    if (m.kind === "ratio") [m.numerator, m.denominator].forEach(visit);
  };
  visit(def.id);
  return order.map((id) => {
    const m = accountingMetrics.require(id);
    const how = [
      ...(m.rules?.common ?? []),
      ...(channels.has("FBA") ? (m.rules?.FBA ?? []).map((r) => `[FBA] ${r}`) : []),
      ...(channels.has("FBM") ? (m.rules?.FBM ?? []).map((r) => `[FBM] ${r}`) : []),
    ];
    return {
      label: m.label,
      ...(row ? { value: roundFor(m.unit, m.value(row)) } : {}),
      ...(m.kind !== "base" ? { formula: m.formula } : {}),
      ...(how.length ? { howCalculated: how } : {}),
      ...(m.sources?.length ? { source: m.sources } : {}),
    };
  });
}

/** Các kiểm tra dữ liệu liên quan tới 1 chỉ số: gộp theo cả cây công thức (Margin → Profit → Ad Spend…) + độ mới dữ liệu. */
export function relatedChecksOf(def: MetricDefinition<AccountingMetricRow>): string[] {
  const out = new Set<string>(["data_lag"]);
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const m = accountingMetrics.require(id);
    m.checks?.forEach((c) => out.add(c));
    if (m.kind === "derived") m.terms.forEach((t) => visit(t.metric));
    if (m.kind === "ratio") [m.numerator, m.denominator].forEach(visit);
  };
  visit(def.id);
  return [...out];
}

const channelsOf = (snap: PnlSnapshot) => new Set(snap.storeChannels.flatMap((s) => s.channels));
const periodInfo = (snap: PnlSnapshot) => ({
  period: snap.period,
  latestDataDate: snap.latestDate,
  stores: snap.stores.map((s) => s.name),
  dataLag: snap.dataLag?.stores ?? null,
});

async function segmentsFor(
  snap: PnlSnapshot,
  by: "store" | "channel" | "day" | "sku",
  which: "current" | "previous",
): Promise<MetricSegment<AccountingMetricRow>[]> {
  if (by === "store") return which === "current" ? snap.byStore : snap.previousByStore;
  if (by === "channel") return which === "current" ? snap.byChannel : snap.previousByChannel;
  if (by === "day") return which === "current" ? snap.byDay : [];
  const period = which === "current" ? snap.period : snap.previousPeriod;
  if (!period) return [];
  return loadSkuSegments(snap, period);
}

const listStores: Tool<Record<string, never>> = {
  name: "list_stores",
  label: "Xem danh sách store",
  permission: "read",
  description: "Danh sách store người hỏi được xem số kế toán, kèm team và kênh (FBA/FBM).",
  input: z.object({}),
  async run(_input, ctx) {
    return ctx.scope.stores.map((s) => ({ id: s.id, name: s.name, team: s.team, marketplace: s.marketplace }));
  },
};

const getDefinition: Tool<{ metric: string }> = {
  name: "get_metric_definition",
  label: "Tra công thức chỉ số",
  permission: "read",
  description:
    "Công thức, quy tắc tính (FBA/FBM), nguồn dữ liệu và các kiểm tra liên quan của 1 chỉ số. Dùng cho câu hỏi 'X tính thế nào', không cần số liệu.",
  input: z.object({ metric: metricField }),
  async run({ metric }) {
    const def = requireMetric(metric);
    return {
      ...describeMetric(def),
      inputs:
        def.kind === "derived"
          ? def.terms.map((t) => `${t.sign === 1 ? "+" : "−"} ${accountingMetrics.require(t.metric).label}`)
          : def.kind === "ratio"
            ? [`tử: ${accountingMetrics.require(def.numerator).label}`, `mẫu: ${accountingMetrics.require(def.denominator).label}`]
            : undefined,
      calculation: calculationSteps(def, new Set(["FBA", "FBM"])),
      relatedChecks: def.checks,
    };
  },
};

const explain: Tool<{ metric: string } & AccountingQuery> = {
  name: "explain_metric",
  label: "Bóc tách công thức",
  permission: "read",
  description:
    "Giá trị của 1 chỉ số trong phạm vi (đúng số Dashboard), công thức, giá trị theo từng store, và `calculation`: TỪNG BƯỚC TÍNH (mỗi khoản: giá trị, công thức, cách tính từ dữ liệu gốc theo kênh FBA/FBM, nguồn dữ liệu). Bước đầu tiên khi giải thích một con số.",
  input: z.object({ metric: metricField, ...scopeFields }),
  async run({ metric, ...query }, ctx) {
    const def = requireMetric(metric);
    assertPayoutAllowed(ctx.scope, def);
    const snap = await snapshot(ctx.scope, query);
    return {
      ...periodInfo(snap),
      ...explainMetric(accountingMetrics, def, snap.total),
      byStore:
        snap.byStore.length > 1 && def.id !== "payout"
          ? snap.byStore.map((s) => ({ store: s.label, value: roundFor(def.unit, def.value(s.row)) }))
          : undefined,
      calculation: calculationSteps(def, channelsOf(snap), snap.total),
      relatedChecks: def.checks,
    };
  },
};

const compare: Tool<
  { metric: string; compareWith: "prev" | "yoy" | "custom"; compareStartDate?: string; compareEndDate?: string; segmentBy: "store" | "channel" | "sku" | "none"; top: number } & AccountingQuery
> = {
  name: "compare_metric",
  label: "So sánh với kỳ trước",
  permission: "read",
  description:
    "So sánh 1 chỉ số giữa kỳ hiện tại và kỳ so sánh, chia mức thay đổi về từng thành phần công thức (drivers) và về từng store / kênh / SKU (segments). Tổng đóng góp = mức thay đổi. Dùng cho câu hỏi 'tại sao tăng / giảm'.",
  input: z.object({
    metric: metricField,
    ...scopeFields,
    compareWith: z
      .enum(["prev", "yoy", "custom"])
      .default("prev")
      .describe("prev = kỳ liền trước cùng độ dài (như Dashboard), yoy = cùng kỳ năm trước, custom = tự chọn"),
    compareStartDate: DATE.optional().describe("Bắt buộc khi compareWith = custom"),
    compareEndDate: DATE.optional().describe("Bắt buộc khi compareWith = custom"),
    segmentBy: z.enum(["store", "channel", "sku", "none"]).default("store").describe("Tách mức thay đổi theo store / kênh / SKU"),
    top: z.number().int().min(1).max(30).default(10),
  }),
  async run({ metric, compareWith, compareStartDate, compareEndDate, segmentBy, top, ...query }, ctx) {
    const def = requireMetric(metric);
    assertPayoutAllowed(ctx.scope, def);
    let current: PnlSnapshot;
    let previous: { total: AccountingMetricRow; snap: PnlSnapshot; period: { startDate: string; endDate: string } };
    if (compareWith === "custom") {
      if (!compareStartDate || !compareEndDate) throw new Error("compareWith = custom cần compareStartDate và compareEndDate.");
      current = await snapshot(ctx.scope, query);
      const prevSnap = await snapshot(ctx.scope, { ...query, startDate: compareStartDate, endDate: compareEndDate });
      previous = { total: prevSnap.total, snap: prevSnap, period: prevSnap.period };
    } else {
      current = await snapshot(ctx.scope, query, compareWith);
      if (!current.previousTotal || !current.previousPeriod) throw new Error("Không xác định được kỳ so sánh.");
      previous = { total: current.previousTotal, snap: current, period: current.previousPeriod };
    }

    let segments: unknown;
    if (segmentBy !== "none" && def.id !== "payout") {
      const cur = await segmentsFor(current, segmentBy, "current");
      const prev =
        compareWith === "custom"
          ? await segmentsFor(previous.snap, segmentBy, "current")
          : await segmentsFor(current, segmentBy, "previous");
      segments = compareBreakdown(accountingMetrics, def, cur, prev, { current: current.total, previous: previous.total }, top);
    }
    return {
      ...periodInfo(current),
      comparePeriod: previous.period,
      ...compareMetric(accountingMetrics, def, current.total, previous.total),
      segments,
      segmentNote:
        segmentBy === "sku"
          ? "Theo SKU dùng công thức tab SKU WIN / LỌC SKU CỐ ĐỊNH; tổng SKU có thể lệch nhẹ so với tổng P&L."
          : undefined,
      relatedChecks: def.checks,
    };
  },
};

const breakdown: Tool<{ metric: string; by: "store" | "channel" | "day" | "sku"; top: number; storeName?: string } & AccountingQuery> = {
  name: "breakdown_metric",
  label: "Tách theo store / SKU / ngày",
  permission: "read",
  description:
    "Tách 1 chỉ số theo store / kênh / ngày / SKU: chỉ số cộng được thì trả giá trị + tỷ trọng; tỷ lệ (Margin, TACOS…) thì trả mức kéo lên / kéo xuống (impact) so với trung bình. Dùng để tìm store / SKU / ngày bất thường.",
  input: z.object({
    metric: metricField,
    ...scopeFields,
    by: z.enum(["store", "channel", "day", "sku"]),
    top: z.number().int().min(1).max(40).default(15),
  }),
  async run({ metric, by, top, ...query }, ctx) {
    const def = requireMetric(metric);
    if (def.id === "payout") throw new Error("Payout chỉ có tổng theo kỳ — dùng trace_source_rows để xem từng lần giải ngân.");
    const snap = await snapshot(ctx.scope, query);
    const segments = await segmentsFor(snap, by, "current");
    return {
      ...periodInfo(snap),
      by,
      ...breakdownMetric(accountingMetrics, def, segments, snap.total, top),
      note:
        by === "sku"
          ? "Theo SKU dùng công thức tab SKU WIN (FBA) / LỌC SKU CỐ ĐỊNH (FBM). 'unallocated' = phần tổng P&L không gán được cho SKU nào (Ads không khớp SKU, SKU ngoài Bảng mã, phí dịch vụ…)."
          : undefined,
    };
  },
};

const checks: Tool<{ metric?: string; checks?: string[] } & AccountingQuery> = {
  name: "check_data_quality",
  label: "Kiểm tra dữ liệu",
  permission: "read",
  description: `Kiểm tra dữ liệu có đủ / đúng không trong phạm vi: ${ACCOUNTING_CHECK_IDS.join(", ")}. Truyền metric để CHỈ chạy các kiểm tra ảnh hưởng tới chỉ số đó (nên dùng). Mỗi kiểm tra trả status ok / warning / info, summary, impact (ảnh hưởng tới chỉ số nào) và ví dụ.`,
  input: z.object({
    ...scopeFields,
    metric: metricField.optional().describe("Chỉ số đang giải thích — chỉ chạy kiểm tra liên quan tới chỉ số này"),
    checks: z.array(z.enum(ACCOUNTING_CHECK_IDS)).optional().describe("Chỉ định cụ thể; bỏ trống = theo metric, hoặc tất cả"),
  }),
  async run({ metric, checks: ids, ...query }, ctx) {
    const snap = await snapshot(ctx.scope, query);
    const selected = ids?.length ? ids : metric ? relatedChecksOf(requireMetric(metric)) : undefined;
    const results = await runAccountingChecks(snap, { checks: selected });
    // Chỉ trả kiểm tra có vấn đề cho model (đỡ token, đỡ bị nhắc lại "không có vấn đề gì" dài dòng)
    return { ...periodInfo(snap), checked: results.map((r) => r.id), issues: results.filter((r) => r.status !== "ok") };
  },
};

const trace: Tool<{ metric: (typeof TRACEABLE_METRICS)[number]; storeName: string; channel: "FBA" | "FBM"; startDate: string; endDate: string; sku?: string; limit: number }> = {
  name: "trace_source_rows",
  label: "Truy dòng dữ liệu gốc",
  permission: "read",
  description:
    "Lấy dòng dữ liệu gốc của 1 thành phần cho 1 store + 1 kênh (đơn hàng đã tính lại từng dòng, dòng ADS, refund, giải ngân, phí dịch vụ) và TỔNG của toàn bộ dòng để đối chiếu với số Dashboard. Có thể lọc 1 SKU.",
  input: z.object({
    metric: z.enum(TRACEABLE_METRICS).describe("Thành phần cần truy (không truy được chỉ số tổng hợp như profit — hãy truy từng thành phần)"),
    storeName: z.string().min(1).max(100),
    channel: z.enum(["FBA", "FBM"]),
    startDate: DATE,
    endDate: DATE,
    sku: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  async run({ storeName, metric, ...rest }, ctx) {
    const def = requireMetric(metric);
    assertPayoutAllowed(ctx.scope, def);
    const snap = await snapshot(ctx.scope, { storeNames: [storeName], startDate: rest.startDate, endDate: rest.endDate });
    const storeId = snap.stores[0]?.id;
    if (!storeId) throw new Error(`Store ${storeName} không có số liệu trong phạm vi.`);
    return traceAccountingSource(snap, {
      metric,
      storeId,
      channel: rest.channel,
      startDate: snap.period.startDate,
      endDate: snap.period.endDate,
      sku: rest.sku,
      limit: rest.limit,
    });
  },
};

export const accountingReconciliationTools: AgentTool<AccountingRunScope>[] = [listStores, getDefinition, explain, compare, breakdown, checks, trace];
