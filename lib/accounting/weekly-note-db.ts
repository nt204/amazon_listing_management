import "server-only";

import { getDatabaseClient } from "@/lib/db";

// Đánh giá tuần (thẻ "Đánh giá" của Báo cáo tuần) — kế toán / admin dán nội dung, mỗi tuần 1 bản.

export interface WeeklyNote {
  text: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function getWeeklyNote(weekStart: string): Promise<WeeklyNote> {
  const sql = await getDatabaseClient();
  const [r] = await sql<{ note: string; updated_by: string | null; updated_at: Date }[]>`
    SELECT note, updated_by, updated_at FROM accounting_weekly_notes WHERE week_start = ${weekStart}::date
  `;
  return r
    ? { text: r.note, updatedBy: r.updated_by, updatedAt: new Date(r.updated_at).toISOString() }
    : { text: "", updatedBy: null, updatedAt: null };
}

/** Nội dung rỗng → xoá */
export async function setWeeklyNote(weekStart: string, text: string, actor: string): Promise<WeeklyNote> {
  const sql = await getDatabaseClient();
  if (!text.trim()) {
    await sql`DELETE FROM accounting_weekly_notes WHERE week_start = ${weekStart}::date`;
    return { text: "", updatedBy: null, updatedAt: null };
  }
  const [r] = await sql<{ note: string; updated_by: string | null; updated_at: Date }[]>`
    INSERT INTO accounting_weekly_notes (week_start, note, updated_by, updated_at)
    VALUES (${weekStart}::date, ${text}, ${actor}, NOW())
    ON CONFLICT (week_start) DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    RETURNING note, updated_by, updated_at
  `;
  return { text: r.note, updatedBy: r.updated_by, updatedAt: new Date(r.updated_at).toISOString() };
}
