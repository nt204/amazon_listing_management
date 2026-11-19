import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetMeta, readSpreadsheetRange } from "@/lib/google/sheets";
import { splitTax } from "@/lib/accounting/kpi-calc";
import { listFbaDaily } from "@/lib/accounting/fba-daily-db";
import {
  emptyPlan,
  halfMonths,
  PLAN_KEYS,
  type PlanHalf,
  type PlanKey,
  type PlanMetrics,
  type StorePlanData,
} from "@/lib/accounting/kpi-plan-calc";

// Tab "Plan" của KPI kinh doanh — mô phỏng file "THEO DÕI KẾ HOẠCH CÁC STORE":
//   mỗi store 1 tab (tên tab = tên store), mỗi kỳ 1 khối: dòng tiêu đề "KỲ I/2026" / "MỤC TIÊU KỲ II/2026",
//   dòng dưới là "T7 | Result | T8 | Result | … | TOTAL | Result", các dòng chỉ tiêu Revenue … MARGIN.
// Cột kế hoạch lưu ở accounting_kpi_store_plans; cột Result tự điền từ số chốt sổ tháng
// (accounting_monthly_store_summary, tháng đã qua), tháng chưa chốt sổ thì dùng Result của sheet nếu có.

const PLAN_SHEET_URL_KEY = "accounting:kpi_plan_sheet_url";

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function readPlan(v: unknown): PlanMetrics | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (!PLAN_KEYS.some((k) => obj[k] != null)) return null;
  const out = emptyPlan();
  for (const k of PLAN_KEYS) out[k] = n(obj[k]);
  return out;
}

/**
 * Mục tiêu tháng theo team (SKU phát triển + SKU test, nạp từ file "KẾ HOẠCH KINH DOANH" của từng store) cộng lại
 * thành mục tiêu cả store — dùng cho tháng chưa có kế hoạch kỳ riêng ở accounting_kpi_store_plans.
 */
export async function teamTargetPlans(storeId: string, months: string[]): Promise<Map<string, PlanMetrics>> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ period: string; metrics: unknown }[]>`
    SELECT period, metrics FROM accounting_kpi_team_targets WHERE store_id = ${storeId} AND period = ANY(${months})
  `;
  const out = new Map<string, PlanMetrics>();
  for (const r of rows) {
    const m = readPlan(r.metrics);
    if (!m) continue;
    const cur = out.get(r.period);
    if (!cur) out.set(r.period, m);
    else for (const k of PLAN_KEYS) cur[k] += m[k];
  }
  return out;
}

export async function getPlanSheetUrl(): Promise<string | null> {
  const sql = await getDatabaseClient();
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = ${PLAN_SHEET_URL_KEY} LIMIT 1`;
  const v = row?.value;
  const url = typeof v === "string" ? v : v && typeof v === "object" ? (v as { url?: unknown }).url : null;
  return typeof url === "string" && url ? url : null;
}

// Tháng chưa chốt sổ: tính từ dữ liệu ngày của hệ thống (như tab FBA theo ngày), cache ngắn để mở lại tab nhanh
const liveCache = new Map<string, { at: number; ttl: number; data: PlanMetrics | null }>();

async function liveMonthResult(storeId: string, period: string, currentPeriod: string): Promise<PlanMetrics | null> {
  const key = `${storeId}:${period}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  const end = `${period}-${String(lastDay).padStart(2, "0")}`;
  const { stats } = await listFbaDaily(storeId, { startDate: `${period}-01`, endDate: end > today ? today : end, limit: 1000 });
  let data: PlanMetrics | null = null;
  if (stats.totalDays > 0 && (stats.totalRevenue || stats.totalAdsFee || stats.totalQuantity)) {
    const revenue = n(stats.totalRevenue);
    const ads = Math.abs(n(stats.totalAdsFee));
    data = {
      revenue,
      quantity: n(stats.totalQuantity),
      ads_fee: ads,
      basecost: Math.abs(n(stats.totalBasecost)),
      amazon_fee: Math.abs(n(stats.totalAmazonFee)),
      ...splitTax(Math.abs(n(stats.totalThue)), ads, revenue),
      return_amount: Math.abs(n(stats.totalReturnCost)),
      storage_fee: 0,
      profit: n(stats.totalNetProfit),
    };
  }
  liveCache.set(key, { at: Date.now(), ttl: period === currentPeriod ? 2 * 60_000 : 10 * 60_000, data });
  return data;
}

export async function getStorePlan(storeId: string, year: number, half: PlanHalf): Promise<StorePlanData> {
  const sql = await getDatabaseClient();
  const months = halfMonths(year, half);
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const [plans, closed, teamPlans] = await Promise.all([
    sql<{ period: string; plan: unknown; sheet_result: unknown; source: string | null; updated_by: string | null; updated_at: Date | null }[]>`
      SELECT period, plan, sheet_result, source, updated_by, updated_at
      FROM accounting_kpi_store_plans WHERE store_id = ${storeId} AND period = ANY(${months})
    `,
    sql<Record<string, string | number | null>[]>`
      SELECT month, total_revenue, total_quantity, total_ads_fee, total_basecost,
             total_amazon_fee_unrecognized, total_amazon_fee_trans, total_thue, total_return_amount, total_storage_fee, net_profit
      FROM accounting_monthly_store_summary
      WHERE store_id = ${storeId} AND year = ${year} AND month BETWEEN ${half === 1 ? 1 : 7} AND ${half === 1 ? 6 : 12}
    `,
    teamTargetPlans(storeId, months),
  ]);
  const planBy = new Map(plans.map((p) => [p.period, p]));
  const closedBy = new Map<string, PlanMetrics>();
  for (const r of closed) {
    const period = `${year}-${String(r.month).padStart(2, "0")}`;
    // Tháng đang chạy chưa chốt sổ → tính tạm từ dữ liệu ngày
    if (period >= currentPeriod) continue;
    // Bảng tổng kết lưu chi phí số âm → đổi sang số dương như sheet
    const revenue = n(r.total_revenue);
    const ads = -n(r.total_ads_fee);
    const { ads_tax, tncn_tax, ref_tax } = splitTax(-n(r.total_thue), ads, revenue);
    closedBy.set(period, {
      revenue,
      quantity: n(r.total_quantity),
      ads_fee: ads,
      basecost: -n(r.total_basecost),
      amazon_fee: -(n(r.total_amazon_fee_unrecognized) + n(r.total_amazon_fee_trans)),
      ads_tax,
      tncn_tax,
      ref_tax,
      return_amount: -n(r.total_return_amount),
      storage_fee: -n(r.total_storage_fee),
      // Profit = lợi nhuận store sau mọi khoản phí (như dòng Profit của sheet)
      profit: n(r.net_profit),
    });
  }
  // Tháng đã qua / đang chạy chưa có số chốt sổ → tự tính từ dữ liệu hệ thống
  const liveBy = new Map<string, PlanMetrics>();
  await Promise.all(
    months
      .filter((p) => p <= currentPeriod && !closedBy.has(p))
      .map(async (p) => {
        const live = await liveMonthResult(storeId, p, currentPeriod).catch(() => null);
        if (live) liveBy.set(p, live);
      }),
  );
  let latest: (typeof plans)[number] | null = null;
  for (const p of plans) if (!latest || (p.updated_at && latest.updated_at && p.updated_at > latest.updated_at)) latest = p;
  return {
    storeId,
    year,
    half,
    months: months.map((period) => {
      const row = planBy.get(period);
      const closedResult = closedBy.get(period) ?? null;
      const liveResult = closedResult ? null : liveBy.get(period) ?? null;
      const sheetResult = closedResult || liveResult ? null : readPlan(row?.sheet_result);
      return {
        period,
        // Chưa có kế hoạch kỳ riêng → lấy tổng mục tiêu tháng của team (dev + test)
        plan: readPlan(row?.plan) ?? teamPlans.get(period) ?? null,
        result: closedResult ?? liveResult ?? sheetResult,
        resultSource: closedResult ? "closed" : liveResult ? (period === currentPeriod ? "running" : "live") : sheetResult ? "sheet" : null,
      };
    }),
    source: latest?.source ?? null,
    updatedBy: latest?.updated_by ?? null,
    updatedAt: latest?.updated_at ? new Date(latest.updated_at).toISOString() : null,
  };
}

/** Sửa tay 1 ô kế hoạch (value null = xoá ô). */
export async function setStorePlanCell(storeId: string, period: string, key: PlanKey, value: number | null, actor: string) {
  const sql = await getDatabaseClient();
  const [row] = await sql<{ plan: unknown }[]>`
    SELECT plan FROM accounting_kpi_store_plans WHERE store_id = ${storeId} AND period = ${period} LIMIT 1
  `;
  const existing = row?.plan as Record<string, unknown> | undefined;
  // Tháng đang hiện mục tiêu team (chưa có kế hoạch riêng) → sửa 1 ô thì giữ nguyên các ô còn lại của mục tiêu team
  const base = existing && readPlan(existing) ? existing : ((await teamTargetPlans(storeId, [period])).get(period) ?? existing ?? {});
  const plan = { ...(base as Record<string, unknown>) };
  if (value == null) delete plan[key];
  else plan[key] = value;
  await sql`
    INSERT INTO accounting_kpi_store_plans (store_id, period, plan, source, updated_by, updated_at)
    VALUES (${storeId}, ${period}, ${sql.json(plan as never)}, 'Sửa tay', ${actor}, NOW())
    ON CONFLICT (store_id, period) DO UPDATE
      SET plan = EXCLUDED.plan, source = 'Sửa tay', updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
}

// ───────────────────────── Nạp từ Google Sheet ─────────────────────────

/** Tên dòng của sheet → khoá (TACOS / ROI / MARGIN tự tính nên bỏ qua). */
function rowKey(label: string): PlanKey | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;
  if (/^(revenue|doanh thu)/.test(s)) return "revenue";
  if (/^(quantity|số lượng)/.test(s)) return "quantity";
  if (/ads tax/.test(s)) return "ads_tax";
  if (/^(ads fee|chi phí quảng cáo)/.test(s)) return "ads_fee";
  if (/^basecost/.test(s)) return "basecost";
  if (/^(amazon fee|amz fee)/.test(s)) return "amazon_fee";
  if (/tncn/.test(s)) return "tncn_tax";
  if (/ref tax/.test(s)) return "ref_tax";
  if (/^return/.test(s)) return "return_amount";
  if (/lưu kho/.test(s)) return "storage_fee";
  if (/profit/.test(s)) return "profit";
  return null;
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(s);
  const x = Number(s.replace(/[()]/g, ""));
  return Number.isFinite(x) ? (neg ? -x : x) : null;
}

/** Tiêu đề khối kỳ: "KỲ II/2025", "KỲ I/2026", "MỤC TIÊU KỲ II/2026" */
function blockHalf(text: unknown): { year: number; half: PlanHalf } | null {
  const m = String(text ?? "").toUpperCase().match(/K[ỲY]\s*(II|I)\s*[/\-–]\s*(\d{4})/);
  if (!m) return null;
  return { year: Number(m[2]), half: m[1] === "II" ? 2 : 1 };
}

interface ParsedMonth {
  period: string;
  plan: Partial<PlanMetrics>;
  result: Partial<PlanMetrics>;
}

/** Đọc mọi khối kỳ của 1 tab store. */
export function parsePlanTab(rows: (string | number | null)[][]): ParsedMonth[] {
  const out = new Map<string, ParsedMonth>();
  for (let i = 0; i < rows.length; i++) {
    const block = blockHalf(rows[i]?.[0]);
    if (!block) continue;
    const header = rows[i + 1] ?? [];
    // Cột kế hoạch "T7" / "T8 (kế hoạch)", cột ngay sau là "Result" của tháng đó
    const cols: { col: number; period: string; kind: "plan" | "result" }[] = [];
    let lastPeriod: string | null = null;
    for (let c = 1; c < header.length; c++) {
      const label = String(header[c] ?? "").trim();
      const mm = label.match(/^T\s*(\d{1,2})\b/i);
      if (mm) {
        const month = Number(mm[1]);
        const okMonth = block.half === 1 ? month >= 1 && month <= 6 : month >= 7 && month <= 12;
        lastPeriod = okMonth ? `${block.year}-${String(month).padStart(2, "0")}` : null;
        if (lastPeriod) cols.push({ col: c, period: lastPeriod, kind: "plan" });
      } else if (/^result/i.test(label) && lastPeriod) {
        cols.push({ col: c, period: lastPeriod, kind: "result" });
        lastPeriod = null;
      } else {
        lastPeriod = null;
      }
    }
    for (let r = i + 2; r < rows.length; r++) {
      const label = rows[r]?.[0];
      if (blockHalf(label)) break;
      if (label == null || String(label).trim() === "") break;
      const key = rowKey(String(label));
      if (!key) continue;
      for (const { col, period, kind } of cols) {
        const v = cellNum(rows[r]?.[col]);
        if (v == null) continue;
        const m = out.get(period) ?? { period, plan: {}, result: {} };
        m[kind][key] = v;
        out.set(period, m);
      }
    }
  }
  return Array.from(out.values()).sort((a, b) => a.period.localeCompare(b.period));
}

export interface PlanImportResult {
  title: string;
  stores: { store: string; tab: string; months: number; periods: string[] }[];
  skippedTabs: string[];
}

/**
 * Nạp kế hoạch mọi store có tab cùng tên trong file. Chỉ ghi các store trong allowedStoreIds.
 * Nạp lại sẽ ghi đè cột kế hoạch + Result sheet của các tháng có trong file; tháng không có trong file giữ nguyên.
 */
export async function importPlansFromSheet(
  url: string,
  stores: { id: string; name: string }[],
  actor: string,
): Promise<PlanImportResult> {
  const meta = await readSpreadsheetMeta(url);
  const sql = await getDatabaseClient();
  const result: PlanImportResult = { title: meta.title, stores: [], skippedTabs: [] };
  for (const tab of meta.tabs) {
    const store = stores.find((s) => s.name.trim().toUpperCase() === tab.trim().toUpperCase());
    if (!store) {
      result.skippedTabs.push(tab);
      continue;
    }
    const rows = await readSpreadsheetRange(meta.spreadsheetId, `'${tab.replace(/'/g, "''")}'!A1:P200`);
    const months = parsePlanTab(rows).filter((m) => Object.keys(m.plan).length || Object.keys(m.result).length);
    for (const m of months) {
      const plan = Object.keys(m.plan).length ? m.plan : null;
      const sheetResult = Object.keys(m.result).length ? m.result : null;
      await sql`
        INSERT INTO accounting_kpi_store_plans (store_id, period, plan, sheet_result, source, updated_by, updated_at)
        VALUES (${store.id}, ${m.period}, ${sql.json((plan ?? {}) as never)}, ${sheetResult ? sql.json(sheetResult as never) : null},
                ${meta.title}, ${actor}, NOW())
        ON CONFLICT (store_id, period) DO UPDATE SET
          plan = CASE WHEN ${plan != null} THEN EXCLUDED.plan ELSE accounting_kpi_store_plans.plan END,
          sheet_result = EXCLUDED.sheet_result,
          source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      `;
    }
    result.stores.push({ store: store.name, tab, months: months.length, periods: months.map((m) => m.period) });
  }
  if (!result.stores.length) {
    throw new ApiError(`Không có tab nào trùng tên store bạn được sửa. Các tab trong file: ${meta.tabs.join(", ")}`, 400);
  }
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${PLAN_SHEET_URL_KEY}, ${sql.json({ url } as never)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return result;
}
