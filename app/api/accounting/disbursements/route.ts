// app/api/accounting/disbursements/route.ts
// API quản lý và lưu trữ dữ liệu đối soát tiền về (Disbursements / Payouts) từ Amazon Seller Central

import { authorize, routeErrorResponse, dataScope } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "accounting"));
    const url = new URL(request.url);
    const storeName = url.searchParams.get("store_name")?.trim();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));

    const sql = await getDatabaseClient();
    const rows = await sql`
      SELECT 
        id, team_id, store_name, currency, payout_amount, payout_status,
        acknowledged_at, acknowledged_date, trace_id, settlement_group,
        period_start, period_end, period_raw, raw_metadata,
        created_at, updated_at
      FROM accounting_payout_disbursements
      WHERE team_id = ${scope.teamId}
        ${storeName ? sql`AND LOWER(store_name) = LOWER(${storeName})` : sql``}
      ORDER BY acknowledged_date DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    `;

    return Response.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy dữ liệu tiền về.");
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "write", "accounting"));
    const body = await request.json();
    const items = Array.isArray(body?.items) ? body.items : (body ? [body] : []);

    if (items.length === 0) {
      return Response.json({ success: true, count: 0, message: "Không có dữ liệu để nạp." });
    }

    const sql = await getDatabaseClient();
    let inserted = 0;
    let updated = 0;

    for (const item of items) {
      const storeName = String(item.store_name || "").trim().toUpperCase();
      const amount = Number(item.payout_amount || 0);
      const status = String(item.payout_status || "Done").trim();
      const ackAt = item.acknowledged_at ? new Date(item.acknowledged_at) : null;
      const ackDate = item.acknowledged_date || (ackAt ? ackAt.toISOString().slice(0, 10) : null);
      const traceId = item.trace_id ? String(item.trace_id).trim() : null;
      const settlementGroup = item.settlement_group ? String(item.settlement_group).trim() : null;
      const periodStart = item.period_start || null;
      const periodEnd = item.period_end || null;
      const periodRaw = item.period_raw ? String(item.period_raw).trim() : null;
      const metadata = item.raw_metadata || null;

      if (!storeName || isNaN(amount)) continue;

      if (traceId) {
        const res = await sql`
          INSERT INTO accounting_payout_disbursements (
            team_id, store_name, currency, payout_amount, payout_status,
            acknowledged_at, acknowledged_date, trace_id, settlement_group,
            period_start, period_end, period_raw, raw_metadata,
            created_at, updated_at
          ) VALUES (
            ${scope.teamId}, ${storeName}, 'USD', ${amount}, ${status},
            ${ackAt}, ${ackDate}, ${traceId}, ${settlementGroup},
            ${periodStart}, ${periodEnd}, ${periodRaw}, ${sql.json(metadata || {})},
            NOW(), NOW()
          )
          ON CONFLICT (store_name, trace_id) WHERE trace_id IS NOT NULL AND trace_id <> ''
          DO UPDATE SET
            payout_amount = EXCLUDED.payout_amount,
            payout_status = EXCLUDED.payout_status,
            acknowledged_at = EXCLUDED.acknowledged_at,
            acknowledged_date = EXCLUDED.acknowledged_date,
            settlement_group = EXCLUDED.settlement_group,
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            raw_metadata = EXCLUDED.raw_metadata,
            updated_at = NOW()
          RETURNING (xmax = 0) AS is_inserted
        `;
        if (res[0]?.is_inserted) inserted++;
        else updated++;
      } else if (settlementGroup && ackAt) {
        const res = await sql`
          INSERT INTO accounting_payout_disbursements (
            team_id, store_name, currency, payout_amount, payout_status,
            acknowledged_at, acknowledged_date, trace_id, settlement_group,
            period_start, period_end, period_raw, raw_metadata,
            created_at, updated_at
          ) VALUES (
            ${scope.teamId}, ${storeName}, 'USD', ${amount}, ${status},
            ${ackAt}, ${ackDate}, ${traceId}, ${settlementGroup},
            ${periodStart}, ${periodEnd}, ${periodRaw}, ${sql.json(metadata || {})},
            NOW(), NOW()
          )
          ON CONFLICT (store_name, settlement_group, acknowledged_at) WHERE (trace_id IS NULL OR trace_id = '') AND settlement_group IS NOT NULL
          DO UPDATE SET
            payout_amount = EXCLUDED.payout_amount,
            payout_status = EXCLUDED.payout_status,
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            raw_metadata = EXCLUDED.raw_metadata,
            updated_at = NOW()
          RETURNING (xmax = 0) AS is_inserted
        `;
        if (res[0]?.is_inserted) inserted++;
        else updated++;
      }
    }

    return Response.json({
      success: true,
      totalReceived: items.length,
      inserted,
      updated,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lưu dữ liệu tiền về.");
  }
}
