import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetTab } from "@/lib/google/sheets";
import { BASE_COST_AUTO_FROM } from "@/lib/accounting/inventory-db";

// Nạp DUY NHẤT tồn + giá đầu năm cho Base Cost tháng từ tab "TỒN" của file <STORE> INVENTORY:
//   "Hàng tồn 1/1/<năm>"  → sl_ton_dau_ky của kỳ mốc (BASE_COST_AUTO_FROM)
//   "Trung bình giá 1/1/<năm>" → basecost_dau_ky của kỳ mốc
// Ghép theo SKU (không theo vị trí dòng). Mọi kỳ sau app tự tính từ dữ liệu server
// (CHI TIẾT ĐI HÀNG, hàng ra kho từ file thô, tồn file Amazon cuối tháng) — không đọc tab BASECOST THÁNG.

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type BaseCostOpeningSyncResult = {
  tabTitle: string | null;
  period: string | null;
  sheetRows: number;
  updated: number;
  inserted: number;
  resyncFrom: string | null;
};

const EMPTY: BaseCostOpeningSyncResult = { tabTitle: null, period: null, sheetRows: 0, updated: 0, inserted: 0, resyncFrom: null };

export async function syncBaseCostOpeningFromSheet(storeId: string, url: string, actor: string): Promise<BaseCostOpeningSyncResult> {
  let sheet: Awaited<ReturnType<typeof readSpreadsheetTab>>;
  try {
    sheet = await readSpreadsheetTab(url, (titles) => titles.find((t) => norm(t) === "ton") ?? null);
  } catch {
    // File INVENTORY chưa có tab TỒN → giữ tồn/giá đầu kỳ hiện có
    return EMPTY;
  }

  const header = (sheet.rows[0] ?? []).map(norm);
  const skuCol = header.indexOf("sku");
  const qtyCol = header.findIndex((h) => h.startsWith("hang ton 1/1"));
  const priceCol = header.findIndex((h) => h.startsWith("trung binh gia 1/1"));
  if (skuCol < 0 || qtyCol < 0 || priceCol < 0) {
    throw new Error(`Tab "${sheet.tabTitle}" thiếu cột SKU / Hàng tồn 1/1 / Trung bình giá 1/1.`);
  }
  // Năm của cột ("Hàng tồn 1/1/2026") phải khớp kỳ mốc, tránh nạp nhầm tồn đầu năm khác
  const year = header[qtyCol].match(/(\d{4})/)?.[1];
  const period = BASE_COST_AUTO_FROM;
  if (!year || `${year}-01` !== period) {
    return { ...EMPTY, tabTitle: sheet.tabTitle };
  }

  const opening = new Map<string, { qty: number; price: number }>();
  for (const row of sheet.rows.slice(1)) {
    const sku = String(row[skuCol] ?? "").replace(/[\n\t\v\f]+/g, "").trim();
    if (!sku || norm(sku) === "sku") continue;
    const qty = Number(row[qtyCol] ?? 0);
    const price = Number(row[priceCol] ?? 0);
    opening.set(sku, { qty: Number.isFinite(qty) ? qty : 0, price: Number.isFinite(price) && price > 0 ? price : 0 });
  }
  if (opening.size === 0) return { ...EMPTY, tabTitle: sheet.tabTitle, period };

  const skus = [...opening.keys()];
  const qtys = skus.map((s) => opening.get(s)!.qty);
  const prices = skus.map((s) => opening.get(s)!.price);

  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    const updated = await tx<{ sku: string }[]>`
      UPDATE accounting_monthly_base_cost b
      SET sl_ton_dau_ky = v.qty, basecost_dau_ky = v.price, gtri_ton_dau_ky = v.qty * v.price,
          last_changed_by = ${actor}, updated_at = NOW()
      FROM unnest(${skus}::text[], ${qtys}::numeric[], ${prices}::numeric[]) AS v(sku, qty, price)
      WHERE b.store_id = ${storeId} AND b.period = ${period} AND b.sku = v.sku AND b.deleted_at IS NULL
        AND (b.sl_ton_dau_ky, b.basecost_dau_ky) IS DISTINCT FROM (v.qty, v.price)
      RETURNING b.sku
    `;
    // SKU có trong tab TỒN nhưng chưa có dòng kỳ mốc: tạo dòng (giá vốn tháng để worker tính)
    const inserted = await tx<{ sku: string }[]>`
      INSERT INTO accounting_monthly_base_cost (
        store_id, period, sku, sku_id, brand, product_type,
        sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
        sl_nhap, gtri_nhap, don_gia_nhap_tb, tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
        calculation_rule, is_overridden, last_changed_by, updated_at
      )
      SELECT ${storeId}, ${period}, v.sku, sm.id, sm.brand, sm.product_type,
        v.qty, v.price, v.qty * v.price,
        0, 0, 0, v.qty, v.qty * v.price, v.price,
        'opening_seed', false, ${actor}, NOW()
      FROM unnest(${skus}::text[], ${qtys}::numeric[], ${prices}::numeric[]) AS v(sku, qty, price)
      LEFT JOIN LATERAL (
        SELECT id, brand, product_type FROM accounting_sku_master
        WHERE store_id = ${storeId} AND sku = v.sku AND deleted_at IS NULL
        ORDER BY row_order NULLS LAST, updated_at DESC LIMIT 1
      ) sm ON true
      WHERE NOT EXISTS (
        SELECT 1 FROM accounting_monthly_base_cost b
        WHERE b.store_id = ${storeId} AND b.period = ${period} AND b.sku = v.sku AND b.deleted_at IS NULL
      )
      ON CONFLICT (store_id, period, sku) DO NOTHING
      RETURNING sku
    `;
    const resyncFrom = updated.length || inserted.length ? period : null;
    if (resyncFrom) await tx`SELECT accounting_enqueue_base_cost_resync(${storeId}::uuid, ${resyncFrom})`;
    return {
      tabTitle: sheet.tabTitle,
      period,
      sheetRows: opening.size,
      updated: updated.length,
      inserted: inserted.length,
      resyncFrom,
    };
  });
}
