import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetTab } from "@/lib/google/sheets";

// Đưa store về Base Cost tính đúng công thức tab "BASECOST THÁNG" (file <STORE> INVENTORY) mà không cần thao tác tay:
//  1. Nạp cột "Đã bán" (hàng ra kho) của từng SKU/tháng vào sl_ra_kho, nguồn 'sheet'.
//     Chỉ cho các kỳ trước kỳ đầu tiên có file thô ('ingest'); từ kỳ đó trở đi Base Cost không phụ thuộc sheet.
//  2. Mở khóa các dòng bị khóa do import Excel (snapshot), để worker tự tính lại theo công thức.
//     Dòng người dùng tự sửa trên web (is_overridden, last_changed_by = người dùng) giữ nguyên.
//  3. Có thay đổi thì xếp hàng worker tính lại Base Cost từ tháng sớm nhất bị đổi.
// Khi store đã có sl_ra_kho, syncMonthlyBaseCostFromInbound tự chuyển sang tồn theo sổ + nhập theo Amazon Received.

// Khóa sinh ra bởi import Excel (không phải người dùng sửa tay) — được phép tự mở
const IMPORT_LOCK_ACTORS = ["unified-importer", "auto-resync"];

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excelSerialToPeriod(value: unknown): string | null {
  const serial = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(serial) || serial < 20000) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type BaseCostOutflowSyncResult = {
  tabTitle: string | null;
  sheetRows: number;
  outflowUpdated: number;
  unlocked: number;
  resyncFrom: string | null;
};

export async function syncBaseCostOutflowFromSheet(storeId: string, url: string, actor: string): Promise<BaseCostOutflowSyncResult> {
  let sheet: Awaited<ReturnType<typeof readSpreadsheetTab>>;
  try {
    sheet = await readSpreadsheetTab(url, (titles) => titles.find((t) => norm(t) === "basecost thang") ?? null);
  } catch {
    // File INVENTORY chưa có tab BASECOST THÁNG → store giữ cách tính Base Cost hiện tại
    return { tabTitle: null, sheetRows: 0, outflowUpdated: 0, unlocked: 0, resyncFrom: null };
  }

  const header = (sheet.rows[0] ?? []).map(norm);
  const col = (name: string) => header.indexOf(name);
  const monthCol = col("month");
  const startCol = col("dau thang");
  const skuCol = col("sku");
  const soldCol = col("da ban");
  if (monthCol < 0 || skuCol < 0 || soldCol < 0) {
    throw new Error(`Tab "${sheet.tabTitle}" thiếu cột Month / SKU / Đã bán.`);
  }

  // Tab chia khối theo tháng; năm lấy từ cột "Đầu tháng" (ngày đầu tháng) ở dòng đầu mỗi khối
  const fallbackYear = new Date().getFullYear();
  const yearByMonth = new Map<number, string>();
  const outflow = new Map<string, number>(); // `${period}|${sku}` → hàng ra kho
  for (const row of sheet.rows.slice(1)) {
    const month = Number(row[monthCol]);
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const startPeriod = startCol >= 0 ? excelSerialToPeriod(row[startCol]) : null;
    if (startPeriod) yearByMonth.set(month, startPeriod.slice(0, 4));
    const sku = String(row[skuCol] ?? "").replace(/[\n\t\v\f]+/g, "").trim();
    if (!sku || norm(sku) === "sku") continue;
    const sold = Number(row[soldCol] ?? 0);
    const period = `${yearByMonth.get(month) ?? fallbackYear}-${String(month).padStart(2, "0")}`;
    outflow.set(`${period}|${sku}`, Number.isFinite(sold) ? sold : 0);
  }
  if (outflow.size === 0) {
    return { tabTitle: sheet.tabTitle, sheetRows: 0, outflowUpdated: 0, unlocked: 0, resyncFrom: null };
  }

  const periods: string[] = [];
  const skus: string[] = [];
  const quantities: number[] = [];
  for (const [key, qty] of outflow) {
    const [period, sku] = key.split("|");
    periods.push(period);
    skus.push(sku);
    quantities.push(qty);
  }

  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    // Bản đồng bộ cũ xóa dấu cách trong SKU ("F-L-150622-HK-N -3" → "F-L-150622-HK-N-3") nên tạo ra SKU trùng.
    // Ẩn bản trùng (không có trong sheet) để lô hàng / phí lưu kho không gắn nhầm vào nó.
    const sheetSkus = [...new Set(skus)];
    await tx`
      UPDATE accounting_sku_master dup
      SET deleted_at = NOW(), last_changed_by = ${actor}, updated_at = NOW()
      WHERE dup.store_id = ${storeId} AND dup.deleted_at IS NULL
        AND dup.sku !~ '\\s' AND NOT (dup.sku = ANY(${sheetSkus}))
        AND EXISTS (
          SELECT 1 FROM accounting_sku_master real
          WHERE real.store_id = dup.store_id AND real.deleted_at IS NULL AND real.id <> dup.id
            AND real.sku ~ '\\s' AND real.sku = ANY(${sheetSkus})
            AND regexp_replace(real.sku, '\\s+', '', 'g') = dup.sku
        )
    `;
    // Mở khóa trước khi ghi hàng ra kho: bước ghi đổi last_changed_by nên chạy sau sẽ không còn nhận ra khóa do import
    const unlocked = await tx<{ period: string }[]>`
      UPDATE accounting_monthly_base_cost b
      SET is_overridden = false, last_changed_by = ${actor}, updated_at = NOW()
      FROM unnest(${periods}::text[], ${skus}::text[]) AS v(period, sku)
      WHERE b.store_id = ${storeId} AND b.period = v.period AND b.sku = v.sku AND b.deleted_at IS NULL
        AND b.is_overridden
        AND (b.calculation_rule = 'excel_source_snapshot' OR b.last_changed_by = ANY(${IMPORT_LOCK_ACTORS}))
      RETURNING b.period
    `;
    const updated = await tx<{ period: string }[]>`
      UPDATE accounting_monthly_base_cost b
      SET sl_ra_kho = v.qty, sl_ra_kho_source = 'sheet', last_changed_by = ${actor}, updated_at = NOW()
      FROM unnest(${periods}::text[], ${skus}::text[], ${quantities}::numeric[]) AS v(period, sku, qty)
      WHERE b.store_id = ${storeId} AND b.period = v.period AND b.sku = v.sku AND b.deleted_at IS NULL
        AND b.sl_ra_kho_source IS DISTINCT FROM 'ingest'
        AND b.sl_ra_kho IS DISTINCT FROM v.qty
        -- Từ kỳ đầu tiên có file thô trở đi, hàng ra kho chỉ tính từ file thô Amazon — sheet chỉ bù các kỳ cũ hơn
        AND b.period < COALESCE((
          SELECT MIN(f.period) FROM accounting_monthly_base_cost f
          WHERE f.store_id = ${storeId} AND f.deleted_at IS NULL AND f.sl_ra_kho_source = 'ingest'
        ), '9999-12')
      RETURNING b.period
    `;
    const changedPeriods = [...updated, ...unlocked].map((r) => r.period).sort();
    const resyncFrom = changedPeriods[0] ?? null;
    if (resyncFrom) await tx`SELECT accounting_enqueue_base_cost_resync(${storeId}::uuid, ${resyncFrom})`;
    return {
      tabTitle: sheet.tabTitle,
      sheetRows: outflow.size,
      outflowUpdated: updated.length,
      unlocked: unlocked.length,
      resyncFrom,
    };
  });
}
