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
export async function loadSkuChannels(ppcStoreId: string): Promise<{
  get: (sku: string) => "FBA" | "FBM" | "";
  getStatus: (sku: string) => string | null;
  hasFbm: boolean;
}> {
  const acc = await getAccountingStoreForPpcStore(ppcStoreId).catch(() => null);
  if (!acc) return { get: () => "", getStatus: () => null, hasFbm: false };
  const sql = await getDatabaseClient();
  const [fba, fbm] = await Promise.all([
    sql<{ sku: string; status: string | null }[]>`
      SELECT DISTINCT ON (upper(trim(sku))) upper(trim(sku)) AS sku, NULLIF(trim(status), '') AS status
      FROM accounting_sku_master
      WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
      ORDER BY upper(trim(sku)), (NULLIF(trim(status), '') IS NULL), updated_at DESC NULLS LAST, id
    `,
    sql<{ sku: string; status: string | null }[]>`
      SELECT DISTINCT ON (upper(trim(sku))) upper(trim(sku)) AS sku, NULLIF(trim(status), '') AS status
      FROM accounting_sku_master_fbm
      WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
      ORDER BY upper(trim(sku)), (NULLIF(trim(status), '') IS NULL), updated_at DESC NULLS LAST, id
    `,
  ]);
  const fbaBySku = new Map(fba.map((r) => [r.sku, r.status]));
  const fbmBySku = new Map(fbm.map((r) => [r.sku, r.status]));
  return {
    hasFbm: fbmBySku.size > 0,
    get: (sku: string) => {
      const k = sku.trim().toUpperCase();
      if (fbmBySku.has(k)) return "FBM";
      if (fbaBySku.has(k)) return "FBA";
      return "";
    },
    getStatus: (sku: string) => {
      const k = sku.trim().toUpperCase();
      return (fbmBySku.has(k) ? fbmBySku.get(k) : fbaBySku.get(k)) ?? null;
    },
  };
}
