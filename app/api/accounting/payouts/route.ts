// app/api/accounting/payouts/route.ts
// Dòng tiền Payout — GET ?start=YYYY-MM-DD&end=YYYY-MM-DD&stores=A,B
// Trả về từng lần tiền về (Disbursements, status Done) trong kỳ + tổng kỳ liền trước theo store để so sánh.
// Chỉ admin / kế toán được xem (khớp quyền xem payout ở Dashboard và Báo cáo tuần).

import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    if (actor.role !== "admin" && actor.role !== "accountant") {
      return Response.json({ error: "Chỉ admin / kế toán được xem dòng tiền payout." }, { status: 403 });
    }

    const url = new URL(request.url);
    const startParam = url.searchParams.get("start") || "";
    const endParam = url.searchParams.get("end") || "";
    const start = DATE_RE.test(startParam) ? startParam : "";
    const end = DATE_RE.test(endParam) ? endParam : "";
    const stores = (url.searchParams.get("stores") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    // Kỳ trước = cùng số ngày, ngay trước kỳ đang xem (chỉ khi kỳ có đủ 2 đầu)
    let previous: { start: string; end: string } | null = null;
    if (start && end && start <= end) {
      const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
      previous = { start: shiftDays(start, -days), end: shiftDays(start, -1) };
    }

    const sql = await getDatabaseClient();
    const storeFilter = stores.length ? sql`AND UPPER(store_name) = ANY(${stores})` : sql``;

    const [rows, prevRows, storeRows] = await Promise.all([
      sql<
        {
          id: string;
          store: string;
          date: string;
          amount: number;
          ack_at: string | null;
          trace_id: string | null;
          settlement_group: string | null;
          period_start: string | null;
          period_end: string | null;
        }[]
      >`
        SELECT id,
          UPPER(store_name) AS store,
          to_char(acknowledged_date, 'YYYY-MM-DD') AS date,
          payout_amount::float AS amount,
          acknowledged_at AS ack_at,
          trace_id, settlement_group,
          to_char(period_start, 'YYYY-MM-DD') AS period_start,
          to_char(period_end, 'YYYY-MM-DD') AS period_end
        FROM accounting_payout_disbursements
        WHERE payout_status = 'Done'
          AND acknowledged_date IS NOT NULL
          ${start ? sql`AND acknowledged_date >= ${start}::date` : sql``}
          ${end ? sql`AND acknowledged_date <= ${end}::date` : sql``}
          ${storeFilter}
        ORDER BY acknowledged_date DESC, acknowledged_at DESC NULLS LAST
      `,
      previous
        ? sql<{ store: string; total: number; count: number }[]>`
            SELECT UPPER(store_name) AS store, SUM(payout_amount)::float AS total, COUNT(*)::int AS count
            FROM accounting_payout_disbursements
            WHERE payout_status = 'Done'
              AND acknowledged_date BETWEEN ${previous.start}::date AND ${previous.end}::date
              ${storeFilter}
            GROUP BY 1
          `
        : Promise.resolve([]),
      // Danh sách store có payout (để lọc + gán màu cố định), không phụ thuộc bộ lọc
      sql<{ store: string; first_date: string; last_date: string }[]>`
        SELECT UPPER(store_name) AS store,
          to_char(MIN(acknowledged_date), 'YYYY-MM-DD') AS first_date,
          to_char(MAX(acknowledged_date), 'YYYY-MM-DD') AS last_date
        FROM accounting_payout_disbursements
        WHERE payout_status = 'Done' AND acknowledged_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    return Response.json({
      range: { start, end },
      previous,
      stores: storeRows.map((r) => ({ name: r.store, firstDate: r.first_date, lastDate: r.last_date })),
      rows: rows.map((r) => ({
        id: r.id,
        store: r.store,
        date: r.date,
        amount: Number(r.amount) || 0,
        ackAt: r.ack_at,
        traceId: r.trace_id,
        settlementGroup: r.settlement_group,
        periodStart: r.period_start,
        periodEnd: r.period_end,
      })),
      previousByStore: prevRows.map((r) => ({ store: r.store, total: Number(r.total) || 0, count: r.count })),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được dòng tiền payout.", 500);
  }
}
