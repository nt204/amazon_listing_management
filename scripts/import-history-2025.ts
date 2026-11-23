// Nạp dữ liệu kinh doanh THEO NGÀY năm 2025 từ các file "<STORE> - KẾ TOÁN TỔNG HỢP 2025" (Google Drive) vào hệ thống,
// để Dashboard so sánh "vs Năm trước" có số từng ngày.
//
// Đọc 3 tab: "Đầu vào Order", "ADS", "RETURN" (tài khoản dịch vụ GOOGLE_SERVICE_ACCOUNT_* phải xem được file).
// Chỉ giữ các ngày năm 2025 TRƯỚC ngày đầu tiên store đã có đơn trên hệ thống (không đè dữ liệu đang chạy).
// Gộp các file cùng store (FASTPEACE có file FBA + FBM) thành 1 file Excel tạm rồi đưa vào bộ nạp sẵn có
// (importUnifiedAccountingExcel). File tạm chỉ có 3 tab trên nên KHÔNG đụng Bảng Mã / Basecost Tháng
// (bộ nạp gắn cứng Basecost Tháng vào năm 2026). Đơn 2025 không có Basecost 2025 thì tự lấy Basecost cùng tháng 2026.
//
// Dùng:
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/import-history-2025.ts            (chạy thử, không ghi)
//   ... scripts/import-history-2025.ts --store=MALFIRST                                                              (1 store)
//   ... scripts/import-history-2025.ts --apply                                                                       (ghi vào DB)
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import ExcelJS from "exceljs";

import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetMeta, readSpreadsheetRange } from "@/lib/google/sheets";
import { normalizeOrderRow } from "@/lib/accounting/orders-db";
import { cleanAdsDate } from "@/lib/accounting/ads-db";
import { cleanReturnDate } from "@/lib/accounting/returns-db";
import { importUnifiedAccountingExcel } from "@/lib/accounting/excel-unified-importer";
import { invalidateAccountingDashboardCache } from "@/lib/accounting/dashboard-db";

const FILES: { store: string; label: string; id: string }[] = [
  { store: "BOZSPACER", label: "BOZSPACER", id: "1ApJJ2pMdRptfWrE_BsgWWs2Injv0E15RjggaL_D9wBM" },
  { store: "MALFIRST", label: "MALFIRST", id: "1CYfvugQdD53Bh-sffne8knMHt9eAFFH2stzJARIUMsk" },
  { store: "LIMIMA", label: "LIMIMA", id: "1VK5wIgtoLDP9eDiRCA3m2CJjKY-PpgEuwt9GsJReMIs" },
  { store: "WARMSTOREY", label: "WARMSTOREY", id: "1rzjmwUZekMtvKCFr5B2lY26Ww-4W886K1oKOViR_oDU" },
  { store: "FASTPEACE", label: "FBA - FASTPEACE", id: "1oXMYKTvzIWuwoPtVClnxWRDZ3y9lo-Kmt_LItRJeAbI" },
  { store: "FASTPEACE", label: "FBM - FASTPEACE", id: "1uTSomONkdHw7qaCLwauD2KhjAxMS4RAOPsGvHWmOTpI" },
];
const TABS = ["Đầu vào Order", "ADS", "RETURN"] as const;
type Tab = (typeof TABS)[number];
const YEAR_START = "2025-01-01";
const YEAR_END = "2026-01-01"; // không gồm
const CHUNK_ROWS = 8000;

type Cell = string | number | null;

async function readTab(id: string, tab: string): Promise<{ headers: string[]; rows: Cell[][] }> {
  const q = `'${tab.replace(/'/g, "''")}'`;
  const head = await readSpreadsheetRange(id, `${q}!1:1`);
  const headers = (head[0] ?? []).map((h) => (h == null ? "" : String(h).trim().replace(/^﻿/, "")));
  const rows: Cell[][] = [];
  for (let start = 2; ; start += CHUNK_ROWS) {
    const part = await readSpreadsheetRange(id, `${q}!A${start}:${colLetter(Math.max(headers.length, 40))}${start + CHUNK_ROWS - 1}`);
    rows.push(...part);
    if (part.length < CHUNK_ROWS) break;
  }
  return { headers, rows };
}

function colLetter(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const rowObject = (headers: string[], row: Cell[]) => {
  const o: Record<string, Cell> = {};
  headers.forEach((h, i) => {
    if (h && o[h] === undefined) o[h] = row[i] ?? null;
  });
  return o;
};

const RATE: Record<string, number> = { USD: 1, CAD: 0.738, MXN: 0.056 };

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyStore = args.find((a) => a.startsWith("--store="))?.slice(8).toUpperCase();
  const sql = await getDatabaseClient();

  const stores = await sql<{ id: string; name: string }[]>`SELECT id, name FROM stores`;
  const storeId = new Map(stores.map((s) => [s.name.trim().toUpperCase(), s.id]));

  const byStore = new Map<string, typeof FILES>();
  for (const f of FILES) {
    if (onlyStore && f.store !== onlyStore) continue;
    byStore.set(f.store, [...(byStore.get(f.store) ?? []), f]);
  }

  for (const [store, files] of byStore) {
    const sid = storeId.get(store);
    if (!sid) {
      console.log(`⚠️ ${store}: không có store trên hệ thống — bỏ qua`);
      continue;
    }
    console.log(`\n===== ${store} (${files.map((f) => f.label).join(" + ")})`);

    // Gộp các file của store: tiêu đề hợp nhất, khử trùng lặp dòng; giữ mọi dòng năm 2025 kèm ngày
    type Picked = { date: string; row: Record<string, Cell>; rev: number; qty: number; ads: number; ret: number };
    const merged: Record<Tab, { headers: string[]; rows: Picked[]; seen: Set<string> }> = {
      "Đầu vào Order": { headers: [], rows: [], seen: new Set() },
      ADS: { headers: [], rows: [], seen: new Set() },
      RETURN: { headers: [], rows: [], seen: new Set() },
    };

    for (const f of files) {
      const meta = await readSpreadsheetMeta(`https://docs.google.com/spreadsheets/d/${f.id}/edit`);
      for (const tab of TABS) {
        if (!meta.tabs.includes(tab)) {
          console.log(`  ${f.label}: không có tab ${tab}`);
          continue;
        }
        const { headers, rows } = await readTab(f.id, tab);
        const target = merged[tab];
        for (const h of headers) if (h && !target.headers.includes(h)) target.headers.push(h);
        let kept = 0;
        const occurrence = new Map<string, number>();
        for (const row of rows) {
          const o = rowObject(headers, row);
          const p: Picked = { date: "", row: o, rev: 0, qty: 0, ads: 0, ret: 0 };
          let key = "";
          if (tab === "Đầu vào Order") {
            const n = normalizeOrderRow(o, sid, null);
            if (!n?.date) continue;
            p.date = n.date;
            // Cùng đơn có thể nằm ở cả file FBA lẫn FBM của 1 store: khoá theo đơn + SKU + item (+ lần xuất hiện trong file)
            const base = `${n.amazon_order_id}|${n.sku}|${n.order_item_id ?? ""}`;
            const occ = (occurrence.get(base) ?? 0) + 1;
            occurrence.set(base, occ);
            key = `${base}|${occ}`;
            if (!/cancel/i.test(String(n.order_status ?? ""))) {
              p.rev = Number(n.item_price ?? 0) * (RATE[String(n.currency ?? "")] ?? 0);
              p.qty = Number(n.quantity ?? 0);
            }
          } else if (tab === "ADS") {
            p.date = cleanAdsDate(o["Date"]) ?? "";
            key = `${p.date}|${o["Portfolio"]}`;
            p.ads = Number(o["Spend(USD)"] ?? 0) || 0;
          } else {
            p.date = cleanReturnDate(o["Date"]) ?? "";
            key = JSON.stringify(row);
            p.ret = Number(o["Total (USD)"] ?? 0) || 0;
          }
          if (!p.date || p.date < YEAR_START || p.date >= YEAR_END || target.seen.has(key)) continue;
          target.seen.add(key);
          target.rows.push(p);
          kept++;
        }
        console.log(`  ${f.label} | ${tab}: đọc ${rows.length.toLocaleString()} dòng, năm 2025: ${kept.toLocaleString()}`);
      }
    }

    // Từng ngày: chỉ nạp khi file có NHIỀU dòng hơn hệ thống (ngày hệ thống đã đủ thì giữ nguyên).
    // Bộ nạp thay nguyên ngày (snapshot theo ngày) nên ngày được chọn sẽ lấy hết dòng của file.
    const sysCount = async (table: "accounting_orders" | "accounting_ads" | "accounting_returns") => {
      const rows = await sql<{ d: string; n: number }[]>`
        SELECT date::text AS d, COUNT(*)::int AS n FROM ${sql(table)}
        WHERE store_id = ${sid} AND date >= ${YEAR_START}::date AND date < ${YEAR_END}::date GROUP BY 1
      `;
      return new Map(rows.map((r) => [r.d, r.n]));
    };
    const tableOf: Record<Tab, "accounting_orders" | "accounting_ads" | "accounting_returns"> = {
      "Đầu vào Order": "accounting_orders",
      ADS: "accounting_ads",
      RETURN: "accounting_returns",
    };
    const monthly = new Map<string, { rev: number; qty: number; ads: number; ret: number; days: Set<string> }>();
    for (const tab of TABS) {
      const sys = await sysCount(tableOf[tab]);
      const fileCount = new Map<string, number>();
      for (const p of merged[tab].rows) fileCount.set(p.date, (fileCount.get(p.date) ?? 0) + 1);
      const take = new Set([...fileCount].filter(([d, n]) => n > (sys.get(d) ?? 0)).map(([d]) => d));
      const skipped = [...fileCount.keys()].filter((d) => !take.has(d)).length;
      merged[tab].rows = merged[tab].rows.filter((p) => take.has(p.date));
      console.log(`  ${tab}: nạp ${take.size} ngày (${merged[tab].rows.length.toLocaleString()} dòng), giữ nguyên ${skipped} ngày hệ thống đã đủ`);
      for (const p of merged[tab].rows) {
        const k = p.date.slice(0, 7);
        if (!monthly.has(k)) monthly.set(k, { rev: 0, qty: 0, ads: 0, ret: 0, days: new Set() });
        const x = monthly.get(k)!;
        x.rev += p.rev;
        x.qty += p.qty;
        x.ads += p.ads;
        x.ret += p.ret;
        if (tab === "Đầu vào Order") x.days.add(p.date);
      }
    }

    // Đối chiếu với số tháng 2025 đã nạp cho KPI (accounting_kpi_sku_history)
    const hist = await sql<{ period: string; rev: number; qty: number; ads: number }[]>`
      SELECT period, SUM(revenue)::float AS rev, SUM(quantity)::float AS qty, SUM(ads_fee)::float AS ads
      FROM accounting_kpi_sku_history
      WHERE store_id = ${sid} AND period >= '2025-01' AND period <= '2025-12'
      GROUP BY period
    `;
    const h = new Map(hist.map((r) => [r.period, r]));
    console.log("  Tháng   | Ngày | Rev nạp | Rev KPI tháng | Units nạp | Units KPI | Ads nạp | Ads KPI | Return");
    for (const k of [...new Set([...monthly.keys(), ...h.keys()])].sort()) {
      const a = monthly.get(k) ?? { rev: 0, qty: 0, ads: 0, ret: 0, days: new Set<string>() };
      const b = h.get(k);
      const f0 = (v: number | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
      console.log(`  ${k} | ${String(a.days.size).padStart(4)} | ${f0(a.rev).padStart(10)} | ${f0(b?.rev).padStart(10)} | ${f0(a.qty).padStart(6)} | ${f0(b?.qty).padStart(6)} | ${f0(a.ads).padStart(7)} | ${f0(b ? Math.abs(b.ads) : undefined).padStart(7)} | ${f0(a.ret)}`);
    }

    if (!apply) continue;

    // Sao lưu dữ liệu năm 2025 hiện có của store trước khi thay (khôi phục: INSERT lại từ bảng *_bak_history2025)
    for (const t of ["accounting_orders", "accounting_ads", "accounting_returns"] as const) {
      const bak = `${t}_bak_history2025`;
      await sql`CREATE TABLE IF NOT EXISTS ${sql(bak)} (LIKE ${sql(t)})`;
      const [{ n }] = await sql<{ n: number }[]>`
        WITH ins AS (
          INSERT INTO ${sql(bak)} SELECT * FROM ${sql(t)}
          WHERE store_id = ${sid} AND date >= ${YEAR_START}::date AND date < ${YEAR_END}::date
          RETURNING 1
        ) SELECT COUNT(*)::int AS n FROM ins
      `;
      console.log(`  Sao lưu ${n.toLocaleString()} dòng ${t} → ${bak}`);
    }

    // Ghi file Excel tạm (chỉ 3 tab) rồi nạp bằng bộ nạp sẵn có
    const file = path.join(os.tmpdir(), `history-2025-${store}-${Date.now()}.xlsx`);
    const wb = new ExcelJS.Workbook();
    for (const tab of TABS) {
      const t = merged[tab];
      if (!t.rows.length) continue;
      const ws = wb.addWorksheet(tab);
      ws.addRow(t.headers);
      for (const r of t.rows) ws.addRow(t.headers.map((hd) => r.row[hd] ?? null));
    }
    await wb.xlsx.writeFile(file);
    console.log(`  → Nạp ${file} ...`);
    const res = await importUnifiedAccountingExcel(file, sid, { removeAfterDone: true });
    console.log(`  ✅ ${res.message}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (apply) await invalidateAccountingDashboardCache().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
