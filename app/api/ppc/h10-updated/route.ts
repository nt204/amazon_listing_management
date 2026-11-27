// app/api/ppc/h10-updated/route.ts
// Thời điểm dữ liệu Helium 10 mới nhất (Search Volume + Organic/Sponsored rank) — hiện ở đầu các tab PPC.
// max(fetched_at) đi theo index idx_*_fetched → đọc 1 dòng, không quét bảng.
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const sql = await getDatabaseClient();
    const [row] = await sql<Array<{ sv_at: string | null; rank_at: string | null }>>`
      SELECT
        to_char((SELECT max(fetched_at) FROM keyword_search_volumes) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sv_at,
        to_char((SELECT max(fetched_at) FROM ppc_asin_keyword_rankings) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS rank_at
    `;
    return Response.json(
      { success: true, data: { searchVolumeAt: row?.sv_at ?? null, rankAt: row?.rank_at ?? null } },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không lấy được thời điểm cập nhật Helium 10.", 500);
  }
}
