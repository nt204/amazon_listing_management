import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { getCachedOrFetch } from "@/lib/redis";

export interface SkuUnitTrends {
  /** Các ngày của kỳ (YYYY-MM-DD), mỗi chuỗi trong `series` có cùng độ dài. */
  dates: string[];
  /** Units theo ngày của từng SKU (khoá = SKU viết hoa, bỏ khoảng trắng đầu cuối). */
  series: Record<string, number[]>;
}

const CACHE_TTL_SECONDS = 600;
// Giới hạn kỳ để chuỗi không quá dài (biểu đồ nhỏ không cần hơn ~1 năm điểm)
const MAX_DAYS = 400;

export const skuTrendKey = (sku: string) => sku.trim().toUpperCase();

function listDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end && dates.length < MAX_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Units bán theo ngày của mọi SKU trong kỳ (đơn không huỷ, cùng nguồn Orders với SKU Win / FBM cố định).
 * Cache cả store theo kỳ rồi lọc theo trang SKU đang xem, nên đổi trang không phải truy vấn lại.
 */
async function loadStoreTrends(storeId: string, channel: "fba" | "fbm", startDate: string, endDate: string) {
  return getCachedOrFetch(`acc:sku-trend:v2:${storeId}:${channel}:${startDate}:${endDate}`, CACHE_TTL_SECONDS, async () => {
    const sql = await getDatabaseClient();
    const rows = await sql<{ sku_key: string; date: string; units: number }[]>`
      SELECT UPPER(TRIM(o.sku)) AS sku_key, o.date::text AS date, SUM(COALESCE(o.quantity, 1))::float AS units
      FROM accounting_orders o
      WHERE o.store_id = ${storeId}
        AND o.fulfillment_channel = ${channel === "fbm" ? "Merchant" : "Amazon"}
        AND o.date >= ${startDate}::date AND o.date <= ${endDate}::date
        AND COALESCE(o.sku, '') <> ''
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY 1, 2
    `;
    const dates = listDates(startDate, endDate);
    const index = new Map(dates.map((d, i) => [d, i]));
    const series: Record<string, number[]> = {};
    for (const r of rows) {
      const i = index.get(r.date);
      if (i == null) continue;
      (series[r.sku_key] ??= new Array(dates.length).fill(0))[i] += r.units;
    }
    // Cắt tới ngày cuối store có đơn: ngày chưa nạp dữ liệu không vẽ thành "tụt về 0"
    const lastIndex = rows.reduce((max, r) => Math.max(max, index.get(r.date) ?? -1), -1);
    const length = lastIndex + 1;
    for (const key of Object.keys(series)) series[key] = series[key].slice(0, length);
    return { dates: dates.slice(0, length), series } satisfies SkuUnitTrends;
  });
}

export async function getSkuUnitTrends(
  storeId: string,
  channel: "fba" | "fbm",
  startDate: string,
  endDate: string,
  skus: string[],
): Promise<SkuUnitTrends> {
  const all = await loadStoreTrends(storeId, channel, startDate, endDate);
  const series: Record<string, number[]> = {};
  for (const sku of skus) {
    const key = skuTrendKey(sku);
    if (all.series[key]) series[key] = all.series[key];
  }
  return { dates: all.dates, series };
}
