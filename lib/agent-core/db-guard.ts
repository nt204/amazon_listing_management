import "server-only";

import type { TransactionSql } from "postgres";
import { getDatabaseClient } from "@/lib/db";

/**
 * Mọi truy vấn agent tự viết (ngoài các hàm Dashboard có sẵn) phải chạy qua đây:
 *   • transaction READ ONLY — agent không thể ghi / xóa dữ liệu dù tool viết sai;
 *   • statement_timeout — truy vấn chậm bị cắt, không làm lag web production (xem AGENTS.md).
 * Truy vấn vẫn phải có điều kiện store + khoảng ngày và LIMIT, không quét toàn bảng.
 */
export async function withAgentReadOnly<T>(fn: (tx: TransactionSql) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  const sql = await getDatabaseClient();
  const result = await sql.begin("read only", async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
    return fn(tx);
  });
  return result as T;
}
