// GET /api/accounting/inventory/sku-master/search-all?search=ABC&exclude_store=<id>&exclude_channel=fba
// Tìm SKU / ASIN / FNSKU trong Bảng mã của MỌI store (cả FBA lẫn FBM) mà người dùng được xem.
// Ô tìm kiếm Inventory chỉ gọi khi store + kênh đang mở không có kết quả → bỏ qua đúng store + kênh đó.

import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingAccess, storeChannelsFor } from "@/lib/accounting/access";
import { getDatabaseClient } from "@/lib/db";
import { listStores } from "@/lib/accounting/accounting-db";
import { skuMasterTable, type SkuChannel } from "@/lib/accounting/inventory-db";

export const runtime = "nodejs";

const CHANNELS: SkuChannel[] = ["fba", "fbm"];
const SAMPLE = 5;

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    if (search.length < 2) return Response.json({ matches: [] });
    const excludeStore = searchParams.get("exclude_store") || "";
    const excludeChannel = searchParams.get("exclude_channel") === "fbm" ? "fbm" : "fba";

    const [access, stores, sql] = await Promise.all([getAccountingAccess(actor), listStores(), getDatabaseClient()]);
    const storeName = new Map(stores.map((s) => [s.id, s.name]));
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const perChannel = await Promise.all(
      CHANNELS.map(async (channel) => {
        const rows = await sql<{ store_id: string; count: number; skus: string[]; asins: (string | null)[] }[]>`
          SELECT store_id,
            COUNT(*)::int AS count,
            (array_agg(sku ORDER BY (LOWER(sku) = ${search}) DESC, (LOWER(COALESCE(asin, '')) = ${search}) DESC, sku))[1:${SAMPLE}] AS skus,
            (array_agg(asin ORDER BY (LOWER(sku) = ${search}) DESC, (LOWER(COALESCE(asin, '')) = ${search}) DESC, sku))[1:${SAMPLE}] AS asins
          FROM ${sql(skuMasterTable(channel))}
          WHERE deleted_at IS NULL
            AND (
              LOWER(sku) LIKE ${pattern}
              OR LOWER(COALESCE(asin, '')) LIKE ${pattern}
              OR LOWER(COALESCE(fnsku, '')) LIKE ${pattern}
            )
          GROUP BY store_id
        `;
        return rows.map((r) => ({ ...r, channel }));
      }),
    );

    const matches = perChannel
      .flat()
      .filter((r) => !(r.store_id === excludeStore && r.channel === excludeChannel))
      .filter((r) => storeName.has(r.store_id))
      .filter((r) => storeChannelsFor(access, r.store_id).includes(r.channel === "fbm" ? "FBM" : "FBA"))
      .map((r) => ({
        storeId: r.store_id,
        storeName: storeName.get(r.store_id)!,
        channel: r.channel,
        count: r.count,
        samples: r.skus.map((sku, i) => ({ sku, asin: r.asins[i] ?? null })),
      }))
      // Store có SKU khớp chính xác lên trước, rồi theo số lượng
      .sort(
        (a, b) =>
          Number(b.samples.some((s) => s.sku.toLowerCase() === search || s.asin?.toLowerCase() === search)) -
            Number(a.samples.some((s) => s.sku.toLowerCase() === search || s.asin?.toLowerCase() === search)) ||
          b.count - a.count,
      );

    return Response.json({ matches });
  } catch (error) {
    return routeErrorResponse(error, "Không tìm được SKU ở các store khác.", 500);
  }
}
