import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { getAccountingStoreForPpcStore } from "@/lib/ppc/sku-architecture-service";

/**
 * SKU thuộc trang FBA hay FBM theo Bảng mã Accounting của store:
 * - FBM: có trong bảng mã FBM;
 * - FBA: có trong bảng mã FBA mà KHÔNG có trong bảng mã FBM (bảng FBA của vài store từng bị nạp lẫn SKU FBM);
 * - "": không có trong bảng mã nào.
 * hasFbm = store có bảng mã FBM (không có thì không cần chia trang).
 */
export async function loadSkuChannels(ppcStoreId: string): Promise<{ get: (sku: string) => "FBA" | "FBM" | ""; hasFbm: boolean }> {
  const acc = await getAccountingStoreForPpcStore(ppcStoreId).catch(() => null);
  if (!acc) return { get: () => "", hasFbm: false };
  const sql = await getDatabaseClient();
  const [fba, fbm] = await Promise.all([
    sql<{ sku: string }[]>`
      SELECT DISTINCT upper(trim(sku)) AS sku FROM accounting_sku_master
      WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
    `,
    sql<{ sku: string }[]>`
      SELECT DISTINCT upper(trim(sku)) AS sku FROM accounting_sku_master_fbm
      WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
    `,
  ]);
  const fbaSet = new Set(fba.map((r) => r.sku));
  const fbmSet = new Set(fbm.map((r) => r.sku));
  return {
    hasFbm: fbmSet.size > 0,
    get: (sku: string) => {
      const k = sku.trim().toUpperCase();
      if (fbmSet.has(k)) return "FBM";
      if (fbaSet.has(k)) return "FBA";
      return "";
    },
  };
}
