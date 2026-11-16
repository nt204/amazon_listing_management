import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetMeta, readSpreadsheetRange } from "@/lib/google/sheets";

// KPI tháng kênh FBM — file "FBM - <STORE> - KẾ HOẠCH KINH DOANH 2026":
//   mỗi tab "Tháng MYYYY" (vd. "Tháng 112026"), hàng 3 có tiêu đề "[Target] T11/2026" ở 1 cột (hiện là J);
//   cột A là tên chỉ tiêu: Revenue, Quantity, Ads Fee, Basecost, Amazon Fee, Promotion, Taxs, Return, Profit
//   (dòng tổng nằm trước các dòng "- SP test" / "- SP Cũ" nên lấy lần xuất hiện đầu tiên).

export interface FbmMonthTarget {
  revenue: number;
  quantity: number;
  profit: number;
}

const LABELS: Record<string, string> = {
  revenue: "revenue",
  quantity: "quantity",
  "ads fee": "adsFee",
  basecost: "basecost",
  "amazon fee": "amazonFee",
  promotion: "promotion",
  taxs: "tax",
  tax: "tax",
  return: "returnAmount",
  profit: "profit",
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(/[,$\s]/g, "")) || 0);

export interface FbmImportResult {
  title: string;
  months: { tab: string; period: string; revenue: number; quantity: number; profit: number }[];
  skipped: string[];
}

export async function importFbmTargetsFromSheet(
  storeId: string,
  url: string,
  actor: string,
  options: { dryRun?: boolean } = {},
): Promise<FbmImportResult> {
  const sql = await getDatabaseClient();
  const [store] = await sql<{ name: string }[]>`SELECT name FROM stores WHERE id = ${storeId}`;
  if (!store) throw new ApiError("Không tìm thấy store.", 404);
  const meta = await readSpreadsheetMeta(url);
  if (!meta.title.toUpperCase().includes(store.name.toUpperCase())) {
    throw new ApiError(`File "${meta.title}" không phải của store ${store.name}.`, 400);
  }
  const tabs = meta.tabs.filter((t) => /^\s*Tháng\s*\d{5,6}\s*$/i.test(t));
  if (!tabs.length) throw new ApiError('File không có tab "Tháng MYYYY" (vd. "Tháng 112026").', 400);

  const months: FbmImportResult["months"] = [];
  const skipped: string[] = [];
  const rows: { period: string; metrics: Record<string, number>; tab: string }[] = [];
  for (const tab of tabs) {
    const grid = await readSpreadsheetRange(meta.spreadsheetId, `'${tab.replace(/'/g, "''")}'!A1:Z40`);
    // Cột có tiêu đề "[Target] T{M}/{YYYY}" ở 5 hàng đầu
    let col = -1;
    let period = "";
    for (const r of grid.slice(0, 5)) {
      r.forEach((cell, i) => {
        const m = String(cell ?? "").match(/^\s*\[Target\]\s*T(\d{1,2})\/(\d{4})\s*$/i);
        if (m && col < 0) {
          col = i;
          period = `${m[2]}-${m[1].padStart(2, "0")}`;
        }
      });
    }
    if (col < 0) {
      skipped.push(tab.trim());
      continue;
    }
    const metrics: Record<string, number> = {};
    for (const r of grid) {
      const key = LABELS[String(r[0] ?? "").trim().toLowerCase()];
      if (key && metrics[key] === undefined) metrics[key] = num(r[col]);
    }
    if (!metrics.revenue && !metrics.profit) {
      skipped.push(tab.trim());
      continue;
    }
    rows.push({ period, metrics, tab: tab.trim() });
    months.push({ tab: tab.trim(), period, revenue: metrics.revenue ?? 0, quantity: metrics.quantity ?? 0, profit: metrics.profit ?? 0 });
  }

  if (!options.dryRun && rows.length) {
    await sql.begin(async (tx) => {
      for (const r of rows) {
        await tx`
          INSERT INTO accounting_kpi_fbm_month_targets (store_id, period, revenue, quantity, profit, metrics, source, updated_by, updated_at)
          VALUES (${storeId}, ${r.period}, ${r.metrics.revenue ?? 0}, ${r.metrics.quantity ?? 0}, ${r.metrics.profit ?? 0},
            ${tx.json(r.metrics)}, ${`${meta.title} / ${r.tab}`}, ${actor}, NOW())
          ON CONFLICT (store_id, period) DO UPDATE SET
            revenue = EXCLUDED.revenue, quantity = EXCLUDED.quantity, profit = EXCLUDED.profit, metrics = EXCLUDED.metrics,
            source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `;
      }
    });
  }
  return { title: meta.title, months: months.sort((a, b) => a.period.localeCompare(b.period)), skipped };
}

/** MT tháng FBM của store (null = chưa nạp) */
export async function getFbmMonthTarget(storeId: string, period: string): Promise<FbmMonthTarget | null> {
  const sql = await getDatabaseClient();
  const [r] = await sql<{ revenue: string; quantity: string; profit: string }[]>`
    SELECT revenue, quantity, profit FROM accounting_kpi_fbm_month_targets WHERE store_id = ${storeId} AND period = ${period}
  `;
  return r ? { revenue: Number(r.revenue), quantity: Number(r.quantity), profit: Number(r.profit) } : null;
}
