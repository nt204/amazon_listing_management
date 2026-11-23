// Nạp số THEO NGÀY kế toán đã chốt năm 2025 (tab "FBA" / "FBM" của file "<STORE> - KẾ TOÁN TỔNG HỢP 2025")
// vào accounting_daily_history. Dashboard dùng số này cho các ngày 2025 thay vì tự tính từ đơn (xem dashboard-db
// fetchStoreDaily) → so sánh "vs Năm trước" khớp đúng sổ kế toán, kể cả Profit.
//
// Tab FBA / FBM: cột B Date, C Revenue, D Quantity, E Ads Fee, F Base Cost, G AMZ Fee, H Thuế, I Promotion,
// J Refund, K Profit (chi phí ghi số âm trong sheet → lưu số dương). Chỉ lấy dòng ngày (bỏ dòng tiêu đề tháng / tuần).
//
// Dùng: node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/import-daily-history-2025.ts [--apply]
import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetMeta, readSpreadsheetRange } from "@/lib/google/sheets";
import { invalidateAccountingDashboardCache } from "@/lib/accounting/dashboard-db";

// tabs: tab → kênh. File FBA của FASTPEACE chỉ lấy tab FBA, file FBM chỉ lấy tab FBM.
const FILES: { store: string; id: string; tabs: Record<string, "FBA" | "FBM"> }[] = [
  { store: "BOZSPACER", id: "1ApJJ2pMdRptfWrE_BsgWWs2Injv0E15RjggaL_D9wBM", tabs: { FBA: "FBA", FBM: "FBM" } },
  { store: "MALFIRST", id: "1CYfvugQdD53Bh-sffne8knMHt9eAFFH2stzJARIUMsk", tabs: { FBA: "FBA", FBM: "FBM" } },
  { store: "LIMIMA", id: "1VK5wIgtoLDP9eDiRCA3m2CJjKY-PpgEuwt9GsJReMIs", tabs: { FBA: "FBA", FBM: "FBM" } },
  { store: "WARMSTOREY", id: "1rzjmwUZekMtvKCFr5B2lY26Ww-4W886K1oKOViR_oDU", tabs: { FBA: "FBA", FBM: "FBM" } },
  { store: "FASTPEACE", id: "1oXMYKTvzIWuwoPtVClnxWRDZ3y9lo-Kmt_LItRJeAbI", tabs: { FBA: "FBA" } },
  { store: "FASTPEACE", id: "1uTSomONkdHw7qaCLwauD2KhjAxMS4RAOPsGvHWmOTpI", tabs: { FBM: "FBM" } },
];

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,%\s]/g, "")) || 0);
const cost = (v: unknown) => -num(v); // sheet ghi chi phí số âm

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = await getDatabaseClient();
  const stores = await sql<{ id: string; name: string }[]>`SELECT id, name FROM stores`;
  const storeId = new Map(stores.map((s) => [s.name.trim().toUpperCase(), s.id]));

  type HistoryRow = {
    store_id: string; channel: "FBA" | "FBM"; date: string; revenue: number; quantity: number; ads_fee: number;
    basecost: number; amazon_fee: number; tax: number; promotion: number; refund: number; profit: number; source: string;
  };
  const rows: HistoryRow[] = [];
  const byKey = new Map<string, HistoryRow>();
  for (const f of FILES) {
    const sid = storeId.get(f.store);
    if (!sid) continue;
    const meta = await readSpreadsheetMeta(`https://docs.google.com/spreadsheets/d/${f.id}/edit`);
    for (const [tab, channel] of Object.entries(f.tabs)) {
      if (!meta.tabs.includes(tab)) continue;
      const monthly = new Map<string, { rev: number; profit: number; days: number }>();
      for (const r of await readSpreadsheetRange(f.id, `'${tab}'!A3:K500`)) {
        const d = r[1];
        if (typeof d !== "number" || d < 45000) continue; // chỉ dòng ngày (serial Google Sheets)
        const date = new Date(Date.UTC(1899, 11, 30) + d * 864e5).toISOString().slice(0, 10);
        if (!date.startsWith("2025")) continue;
        const row: HistoryRow = {
          store_id: sid,
          channel,
          date,
          revenue: num(r[2]),
          quantity: num(r[3]),
          ads_fee: cost(r[4]),
          basecost: cost(r[5]),
          amazon_fee: cost(r[6]),
          tax: cost(r[7]),
          promotion: cost(r[8]),
          refund: cost(r[9]),
          profit: num(r[10]),
          source: `sheet:${f.id}:${tab}`,
        };
        // Ngày sheet ghi 0 vẫn nạp: số kế toán đã chốt là 0 thì Dashboard cũng hiện 0 (không lấy số tự tính lấp vào).
        // Mẫu sheet đôi khi lặp 1 ngày (dòng 0 ở đầu tuần mới): giữ 1 dòng / ngày, ưu tiên dòng có số.
        const k = `${sid}|${channel}|${date}`;
        const prev = byKey.get(k);
        const hasData = (x: HistoryRow) => Boolean(x.revenue || x.quantity || x.ads_fee || x.profit || x.refund);
        if (prev && (hasData(prev) || !hasData(row))) continue;
        if (prev) rows.splice(rows.indexOf(prev), 1);
        byKey.set(k, row);
        rows.push(row);
        const m = date.slice(0, 7);
        const x = monthly.get(m) ?? { rev: 0, profit: 0, days: 0 };
        x.rev += row.revenue;
        x.profit += row.profit;
        x.days += 1;
        monthly.set(m, x);
      }
      const tot = [...monthly.values()].reduce((a, b) => ({ rev: a.rev + b.rev, profit: a.profit + b.profit, days: a.days + b.days }), { rev: 0, profit: 0, days: 0 });
      console.log(`${f.store} ${channel} (tab ${tab}): ${tot.days} ngày, Revenue ${Math.round(tot.rev).toLocaleString("en-US")}, Profit ${Math.round(tot.profit).toLocaleString("en-US")}`);
    }
  }
  console.log(`Tổng ${rows.length.toLocaleString()} dòng ngày.`);
  if (!apply) return process.exit(0);

  await sql.begin(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx`
        INSERT INTO accounting_daily_history ${tx(rows.slice(i, i + 500))}
        ON CONFLICT (store_id, channel, date) DO UPDATE SET
          revenue = EXCLUDED.revenue, quantity = EXCLUDED.quantity, ads_fee = EXCLUDED.ads_fee, basecost = EXCLUDED.basecost,
          amazon_fee = EXCLUDED.amazon_fee, tax = EXCLUDED.tax, promotion = EXCLUDED.promotion, refund = EXCLUDED.refund,
          profit = EXCLUDED.profit, source = EXCLUDED.source, imported_at = NOW()
      `;
    }
    // Cache Dashboard của các tháng cũ chỉ làm nguội khi phiên bản dữ liệu cũ tăng
    await tx`SELECT nextval('accounting_dashboard_history_version')`;
  });
  await invalidateAccountingDashboardCache().catch(() => {});
  console.log(`✅ Đã nạp ${rows.length.toLocaleString()} dòng.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
