import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { CASHFLOW_FIELDS, closingOf, type CashflowValues, type WeeklyCashflow } from "@/lib/accounting/weekly-cashflow";

const clean = (data: unknown): CashflowValues => {
  const out: CashflowValues = {};
  if (!data || typeof data !== "object") return out;
  for (const k of CASHFLOW_FIELDS) {
    const v = Number((data as Record<string, unknown>)[k]);
    if ((data as Record<string, unknown>)[k] != null && Number.isFinite(v)) out[k] = v;
  }
  return out;
};

/**
 * Số liệu tuần + số dư mang sang: chạy dồn từ tuần đầu tiên có nhập tới tuần trước tuần đang xem
 * (tuần nào có "Số dư đầu tuần" nhập tay thì lấy số đó làm mốc mới).
 */
export async function getWeeklyCashflow(weekStart: string): Promise<WeeklyCashflow> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ week_start: string; data: unknown; updated_by: string | null; updated_at: Date }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, data, updated_by, updated_at
    FROM accounting_weekly_cashflow
    WHERE week_start <= ${weekStart}::date
    ORDER BY week_start
  `;
  let closing: number | null = null;
  let current: (typeof rows)[number] | null = null;
  for (const r of rows) {
    const v = clean(r.data);
    if (r.week_start === weekStart) {
      current = r;
      break;
    }
    closing = closingOf(v.openingBalance ?? closing, v);
  }
  return {
    weekStart,
    values: current ? clean(current.data) : {},
    carriedOpening: closing,
    updatedBy: current?.updated_by ?? null,
    updatedAt: current?.updated_at ? new Date(current.updated_at).toISOString() : null,
  };
}

/** Ghép patch vào số liệu tuần (giá trị null = xoá ô đó) */
export async function updateWeeklyCashflow(weekStart: string, patch: Record<string, number | null>, actor: string) {
  const sql = await getDatabaseClient();
  const [row] = await sql<{ data: unknown }[]>`SELECT data FROM accounting_weekly_cashflow WHERE week_start = ${weekStart}::date`;
  const next: Record<string, number> = { ...clean(row?.data) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(CASHFLOW_FIELDS as readonly string[]).includes(k)) continue;
    if (v == null) delete next[k];
    else next[k] = v;
  }
  await sql`
    INSERT INTO accounting_weekly_cashflow (week_start, data, updated_by, updated_at)
    VALUES (${weekStart}::date, ${sql.json(next)}, ${actor}, NOW())
    ON CONFLICT (week_start)
    DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
  return next;
}
