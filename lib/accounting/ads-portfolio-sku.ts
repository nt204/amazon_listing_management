/**
 * SKU của 1 portfolio Ads = chữ cuối tên portfolio (vd "Linh Ornament Trumpet All FBM Test HOTT1007T01C").
 * Có portfolio bị đặt nhầm ASIN thay cho SKU ("… FBM Test B0HMCYZC7T"): chữ cuối là ASIN thì tra bảng mã
 * ASIN → SKU. ASIN ứng với nhiều SKU khác nhau trong bảng mã thì không đoán (giữ nguyên ASIN) để khỏi gán nhầm.
 */

// Tag SQL của postgres.js (client hoặc transaction): chỉ dùng để dựng fragment.
type SqlTag = (strings: TemplateStringsArray, ...values: any[]) => any;

export const ASIN_PATTERN = /^B0[A-Z0-9]{8}$/i;
const ASIN_REGEX_SQL = "^B0[A-Z0-9]{8}$";

/** Chữ cuối của portfolio, viết hoa. `column` là tên cột/biểu thức portfolio đã an toàn (không lấy từ input). */
export function portfolioTailSql(sql: SqlTag & { unsafe: (s: string) => any }, column = "portfolio") {
  return sql`UPPER(substring(COALESCE(${sql.unsafe(column)}, '') from '([^ ]*)$'))`;
}

/**
 * Subquery (store_id, asin_key, sku_key): ASIN chỉ ứng với đúng 1 SKU trong bảng mã của các store đã cho.
 * `master` = "fbm" (accounting_sku_master_fbm) hoặc "fba" (accounting_sku_master).
 */
export function asinSkuMapSql(sql: SqlTag & { unsafe: (s: string) => any }, master: "fba" | "fbm", storeIds: string[]) {
  const table = sql.unsafe(master === "fbm" ? "accounting_sku_master_fbm" : "accounting_sku_master");
  return sql`
    SELECT store_id, UPPER(TRIM(asin)) AS asin_key, MIN(UPPER(TRIM(sku))) AS sku_key
    FROM ${table}
    WHERE store_id = ANY(${storeIds}::uuid[])
      AND deleted_at IS NULL
      AND UPPER(TRIM(COALESCE(asin, ''))) ~ ${ASIN_REGEX_SQL}
      AND COALESCE(TRIM(sku), '') <> ''
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT UPPER(TRIM(sku))) = 1
  `;
}

/** Map ASIN (viết hoa) → SKU (viết hoa) cho code JS lúc import; ASIN nhiều SKU bị bỏ. */
export function buildAsinSkuMap(rows: Array<{ sku: string | null; asin: string | null }>): Map<string, string> {
  const skusByAsin = new Map<string, Set<string>>();
  for (const r of rows) {
    const asin = String(r.asin ?? "").trim().toUpperCase();
    const sku = String(r.sku ?? "").trim().toUpperCase();
    if (!sku || !ASIN_PATTERN.test(asin)) continue;
    const set = skusByAsin.get(asin) ?? new Set<string>();
    set.add(sku);
    skusByAsin.set(asin, set);
  }
  const map = new Map<string, string>();
  for (const [asin, skus] of skusByAsin) if (skus.size === 1) map.set(asin, [...skus][0]);
  return map;
}

/** SKU lấy từ portfolio lúc import: chữ cuối là ASIN có trong bảng mã thì đổi sang SKU tương ứng. */
export function resolvePortfolioSku(sku: string, asinToSku: Map<string, string>): string {
  const key = sku.trim().toUpperCase();
  return ASIN_PATTERN.test(key) ? asinToSku.get(key) ?? sku : sku;
}
