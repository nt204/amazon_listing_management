import type { PendingQuery, Row } from "postgres";
import type { getDatabaseClient } from "@/lib/db";
import type { ParsedMetricRange } from "@/lib/ppc/manual-bid";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;
type Fragment = PendingQuery<Row[]>;

/** Biểu thức SQL của 4 số gốc (cột của dòng, hoặc SUM(...) khi dùng trong HAVING) */
export interface MetricColumns {
  spend: Fragment;
  sales: Fragment;
  clicks: Fragment;
  orders: Fragment;
}

/** Cột trần (spend, sales, clicks, orders) — dùng trong CTE đã có sẵn các cột này */
export function plainMetricColumns(sql: Sql, prefix = ""): MetricColumns {
  const col = (name: string) => (prefix ? sql`${sql(prefix)}.${sql(name)}` : sql`${sql(name)}`);
  return { spend: col("spend"), sales: col("sales"), clicks: col("clicks"), orders: col("orders") };
}

/**
 * Điều kiện "AND ..." cho nút "Lọc" (Spend / Sales / ACOS / Click / Order / CPC / CVR từ – đến).
 * Giống lọc trên web (passesMetricRanges): ACOS cần sales > 0, CPC / CVR cần clicks > 0, không thì loại.
 */
export function metricRangeSql(sql: Sql, ranges: ParsedMetricRange[], c: MetricColumns): Fragment {
  let out = sql``;
  for (const r of ranges) {
    let guard = sql`TRUE`;
    let value: Fragment;
    switch (r.key) {
      case "acos":
        guard = sql`${c.sales} > 0`;
        value = sql`(${c.spend})::numeric / NULLIF(${c.sales}, 0) * 100`;
        break;
      case "cpc":
        guard = sql`${c.clicks} > 0`;
        value = sql`(${c.spend})::numeric / NULLIF(${c.clicks}, 0)`;
        break;
      case "cvr":
        guard = sql`${c.clicks} > 0`;
        value = sql`(${c.orders})::numeric / NULLIF(${c.clicks}, 0) * 100`;
        break;
      default:
        value = sql`(${c[r.key]})::numeric`;
    }
    out = sql`${out} AND ${guard}`;
    if (r.min != null) out = sql`${out} AND ${value} >= ${r.min}`;
    if (r.max != null) out = sql`${out} AND ${value} <= ${r.max}`;
  }
  return out;
}
