import "server-only";

import { getDatabaseClient } from "@/lib/db";

// Mục tiêu units tuần của từng team (Báo cáo tuần, bảng Kinh doanh theo Team) — chốt ở buổi check-in tuần.
// Riêng với mục tiêu tháng (sheet KPI). Khoá: (ngày đầu đoạn tuần, tên team như "FBA TEAM 2" / "FBM").

/** team → units của 1 tuần */
export async function getWeeklyUnitTargets(weekStart: string): Promise<Record<string, number>> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ team: string; units: number }[]>`
    SELECT team, units FROM accounting_weekly_unit_targets WHERE week_start = ${weekStart}::date
  `;
  return Object.fromEntries(rows.map((r) => [r.team, Number(r.units)]));
}

/** units = null → xoá mục tiêu của team trong tuần */
export async function setWeeklyUnitTarget(weekStart: string, team: string, units: number | null, actor: string) {
  const sql = await getDatabaseClient();
  if (units == null) {
    await sql`DELETE FROM accounting_weekly_unit_targets WHERE week_start = ${weekStart}::date AND team = ${team}`;
    return;
  }
  await sql`
    INSERT INTO accounting_weekly_unit_targets (week_start, team, units, updated_by, updated_at)
    VALUES (${weekStart}::date, ${team}, ${units}, ${actor}, NOW())
    ON CONFLICT (week_start, team) DO UPDATE SET units = EXCLUDED.units, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
}
