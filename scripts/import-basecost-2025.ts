// Nạp Base Cost tháng năm 2025 từ tab "BASECOST THÁNG" của file "TỔNG HỢP FBA INVENTORY 2025" vào accounting_monthly_base_cost
// (kỳ 2025-01 → 2025-12). Kỳ trước BASE_COST_AUTO_FROM (2026-01) app không tính lại, nên số nạp giữ nguyên.
// Đơn năm 2025 (fba-daily-db monthlyBasecostJoin) ưu tiên Base Cost đúng kỳ YYYY-MM → Profit FBA 2025 dùng giá vốn 2025.
// Dòng nạp đánh dấu calculation_rule = 'history_2025_sheet', last_changed_by = 'history-2025-import'.
//
// Dùng: node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/import-basecost-2025.ts [--apply]
import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetRange } from "@/lib/google/sheets";
import { invalidateAccountingDashboardCache } from "@/lib/accounting/dashboard-db";

const SHEET_ID = "1pzj1TgY8w6qovQvNd8nfQAu04OZpvv3e7PBtf2_7138";
const TAB = "BASECOST THÁNG";

const num = (v: unknown) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const serialYear = (v: unknown) =>
  typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + v * 864e5).getUTCFullYear() : Number(String(v ?? "").match(/(\d{4})/)?.[1]);

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = await getDatabaseClient();
  const stores = await sql<{ id: string; name: string }[]>`SELECT id, name FROM stores`;
  const storeId = new Map(stores.map((s) => [s.name.trim().toUpperCase(), s.id]));
  const masters = await sql<{ store_id: string; sku: string; id: string; product_type: string | null }[]>`
    SELECT store_id, UPPER(sku) AS sku, id, product_type FROM accounting_sku_master WHERE deleted_at IS NULL
  `;
  const master = new Map(masters.map((m) => [`${m.store_id}|${m.sku}`, m]));

  const rows = await readSpreadsheetRange(SHEET_ID, `'${TAB}'!A2:N`);
  const items: Record<string, unknown>[] = [];
  const skipped = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of rows) {
    const [month, start, , brandRaw, skuRaw, , tonDau, giaDau, slNhap, tienDi, giaTb, , basecost] = r;
    const brand = String(brandRaw ?? "").trim().toUpperCase();
    const sku = String(skuRaw ?? "").trim();
    const m = Number(month);
    const y = serialYear(start);
    if (!brand || brand === "BRAND" || !sku || !(m >= 1 && m <= 12) || y !== 2025) continue;
    const sid = storeId.get(brand);
    if (!sid) {
      skipped.set(brand, (skipped.get(brand) ?? 0) + 1);
      continue;
    }
    const period = `2025-${String(m).padStart(2, "0")}`;
    const key = `${sid}|${period}|${sku.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = master.get(`${sid}|${sku.toUpperCase()}`);
    const sl = num(tonDau), gia = num(giaDau), nhap = num(slNhap), tien = num(tienDi);
    items.push({
      store_id: sid,
      period,
      sku,
      sku_id: meta?.id ?? null,
      brand,
      product_type: meta?.product_type ?? null,
      sl_ton_dau_ky: sl,
      basecost_dau_ky: gia,
      gtri_ton_dau_ky: sl * gia,
      sl_nhap: nhap,
      gtri_nhap: tien,
      don_gia_nhap_tb: num(giaTb),
      tong_sl_kha_dung: sl + nhap,
      tong_gtri_kha_dung: sl * gia + tien,
      basecost_thang: num(basecost),
      calculation_rule: "history_2025_sheet",
      is_overridden: false,
      last_changed_by: "history-2025-import",
    });
  }

  const byStore = new Map<string, number>();
  for (const it of items) byStore.set(String(it.brand), (byStore.get(String(it.brand)) ?? 0) + 1);
  console.log("Dòng 2025 theo store:", Object.fromEntries(byStore));
  console.log("Bỏ qua (không có store trên hệ thống):", Object.fromEntries(skipped));
  const [existing] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM accounting_monthly_base_cost WHERE period >= '2025-01' AND period <= '2025-12'
  `;
  console.log(`Hệ thống đang có ${existing.n} dòng Base Cost kỳ 2025 (sẽ được ghi đè theo SKU nếu trùng).`);
  if (!apply) return process.exit(0);

  await sql.begin(async (tx) => {
    await tx`CREATE TABLE IF NOT EXISTS accounting_monthly_base_cost_bak_history2025 (LIKE accounting_monthly_base_cost)`;
    await tx`
      INSERT INTO accounting_monthly_base_cost_bak_history2025
      SELECT * FROM accounting_monthly_base_cost WHERE period >= '2025-01' AND period <= '2025-12'
    `;
    for (let i = 0; i < items.length; i += 500) {
      await tx`
        INSERT INTO accounting_monthly_base_cost ${tx(items.slice(i, i + 500) as Record<string, string | number | boolean | null>[])}
        ON CONFLICT (store_id, period, sku) DO UPDATE SET
          sku_id = COALESCE(EXCLUDED.sku_id, accounting_monthly_base_cost.sku_id),
          brand = EXCLUDED.brand,
          product_type = COALESCE(EXCLUDED.product_type, accounting_monthly_base_cost.product_type),
          sl_ton_dau_ky = EXCLUDED.sl_ton_dau_ky,
          basecost_dau_ky = EXCLUDED.basecost_dau_ky,
          gtri_ton_dau_ky = EXCLUDED.gtri_ton_dau_ky,
          sl_nhap = EXCLUDED.sl_nhap,
          gtri_nhap = EXCLUDED.gtri_nhap,
          don_gia_nhap_tb = EXCLUDED.don_gia_nhap_tb,
          tong_sl_kha_dung = EXCLUDED.tong_sl_kha_dung,
          tong_gtri_kha_dung = EXCLUDED.tong_gtri_kha_dung,
          basecost_thang = EXCLUDED.basecost_thang,
          calculation_rule = EXCLUDED.calculation_rule,
          last_changed_by = EXCLUDED.last_changed_by,
          deleted_at = NULL,
          updated_at = NOW()
      `;
    }
  });
  await invalidateAccountingDashboardCache().catch(() => {});
  console.log(`✅ Đã nạp ${items.length.toLocaleString()} dòng Base Cost 2025.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
