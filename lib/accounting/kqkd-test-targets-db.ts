import { getDatabaseClient } from "@/lib/db";

/** KPI số mẫu test đi hàng của cả store trong một tháng (null = chưa đặt) */
export async function getStoreTestTarget(storeId: string, month: string): Promise<number | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ target: number }[]>`
    SELECT target FROM accounting_kqkd_store_test_targets
    WHERE store_id = ${storeId} AND month = ${month}
    LIMIT 1
  `;
  return rows.length ? Number(rows[0].target) : null;
}

/** target = null: xoá (về trạng thái chưa đặt) */
export async function setStoreTestTarget(storeId: string, month: string, target: number | null, actor: string) {
  const sql = await getDatabaseClient();
  if (target == null) {
    await sql`
      DELETE FROM accounting_kqkd_store_test_targets
      WHERE store_id = ${storeId} AND month = ${month}
    `;
    return;
  }
  await sql`
    INSERT INTO accounting_kqkd_store_test_targets (store_id, month, target, updated_by, updated_at)
    VALUES (${storeId}, ${month}, ${target}, ${actor}, NOW())
    ON CONFLICT (store_id, month)
    DO UPDATE SET target = EXCLUDED.target, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
}
