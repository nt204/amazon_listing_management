import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { readSpreadsheetTab } from "@/lib/google/sheets";

// Nạp "giá tồn đầu năm" của từng SKU từ tab TỒN (file <STORE> INVENTORY <năm>), cột "Trung bình giá 1/1/<năm>".
// Giá trị tồn của SKU không có lô nào trong CHI TIẾT ĐI HÀNG tính theo giá này, giống cột
// BASECOST TB/NĂM = IF(SL ĐI HÀNG/NĂM <= 0, Trung bình giá 1/1, TIỀN HÀNG/NĂM / SL ĐI HÀNG/NĂM) của sheet.
// Chỉ ghi SKU có trên sheet; SKU không có trên sheet giữ giá cũ.

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Khóa so khớp SKU: bỏ mọi khoảng trắng, không phân biệt hoa/thường (giống khóa Chi Tiết Đi Hàng ↔ Bảng Mã). */
function skuKey(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

export type OpeningCostSyncResult = { tabTitle: string | null; sheetRows: number; updated: number };

export async function syncOpeningCostFromSheet(storeId: string, url: string): Promise<OpeningCostSyncResult> {
  let sheet: Awaited<ReturnType<typeof readSpreadsheetTab>>;
  try {
    sheet = await readSpreadsheetTab(url, (titles) => titles.find((t) => norm(t) === "ton") ?? null);
  } catch {
    // File INVENTORY chưa có tab TỒN → giữ giá đang có
    return { tabTitle: null, sheetRows: 0, updated: 0 };
  }

  const headerIndex = sheet.rows.slice(0, 5).findIndex((row) => row.some((v) => norm(v) === "sku"));
  if (headerIndex === -1) throw new Error(`Tab "${sheet.tabTitle}" không có dòng tiêu đề có cột SKU.`);
  const header = sheet.rows[headerIndex].map(norm);
  const skuCol = header.indexOf("sku");
  const priceCol = header.findIndex((h) => h.startsWith("trung binh gia 1/1"));
  if (priceCol === -1) throw new Error(`Tab "${sheet.tabTitle}" thiếu cột "Trung bình giá 1/1".`);

  const prices = new Map<string, number>();
  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const key = skuKey(String(row[skuCol] ?? "").replace(/[\n\t\v\f]+/g, ""));
    const price = typeof row[priceCol] === "number" ? (row[priceCol] as number) : Number.NaN;
    if (!key || key === "SKU" || !Number.isFinite(price) || price < 0) continue;
    prices.set(key, Math.round(price * 1e6) / 1e6);
  }
  if (prices.size === 0) return { tabTitle: sheet.tabTitle, sheetRows: 0, updated: 0 };

  const sql = await getDatabaseClient();
  const keys = [...prices.keys()];
  const values = keys.map((key) => prices.get(key)!);
  const updated = await sql`
    UPDATE accounting_sku_master asm
    SET gia_ton_dau_nam = v.price, updated_at = NOW()
    FROM UNNEST(${keys}::text[], ${values}::numeric[]) AS v(sku_key, price)
    WHERE asm.store_id = ${storeId}
      AND REPLACE(UPPER(asm.sku), ' ', '') = v.sku_key
      AND asm.gia_ton_dau_nam IS DISTINCT FROM v.price
  `;
  return { tabTitle: sheet.tabTitle, sheetRows: prices.size, updated: updated.count };
}
