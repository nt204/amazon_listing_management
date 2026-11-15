import "server-only";

import { getDatabaseClient } from "@/lib/db";

// Trả trước cho nhà cung cấp (SUP) theo store × tuần — kế toán nhập tay ở bảng Tồn kho của Báo cáo tuần
// (cột hồng "SL trả trước cho SUP", "Giá trị trả trước ($)" của sheet BÁO CÁO TUẦN TỔNG HỢP).

export interface WeeklyPrepaid {
  units: number | null;
  value: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Trả trước của các store trong tuần (key = store_id) */
export async function getWeeklyPrepaid(storeIds: string[], weekStart: string): Promise<Map<string, WeeklyPrepaid>> {
  const out = new Map<string, WeeklyPrepaid>();
  if (!storeIds.length) return out;
  const sql = await getDatabaseClient();
  const rows = await sql<{ store_id: string; units: number | null; value: string | null; updated_by: string | null; updated_at: Date }[]>`
    SELECT store_id::text, units, value, updated_by, updated_at
    FROM accounting_weekly_prepaid_stock
    WHERE week_start = ${weekStart}::date AND store_id::text IN ${sql(storeIds)}
  `;
  for (const r of rows) {
    out.set(r.store_id, {
      units: r.units == null ? null : Number(r.units),
      value: r.value == null ? null : Number(r.value),
      updatedBy: r.updated_by,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    });
  }
  return out;
}

/** Cả hai trống → xoá dòng (về trạng thái chưa nhập) */
export async function setWeeklyPrepaid(
  storeId: string,
  weekStart: string,
  units: number | null,
  value: number | null,
  actor: string,
): Promise<void> {
  const sql = await getDatabaseClient();
  if (units == null && value == null) {
    await sql`DELETE FROM accounting_weekly_prepaid_stock WHERE store_id = ${storeId} AND week_start = ${weekStart}::date`;
    return;
  }
  await sql`
    INSERT INTO accounting_weekly_prepaid_stock (store_id, week_start, units, value, updated_by, updated_at)
    VALUES (${storeId}, ${weekStart}::date, ${units}, ${value}, ${actor}, NOW())
    ON CONFLICT (store_id, week_start)
    DO UPDATE SET units = EXCLUDED.units, value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
}
