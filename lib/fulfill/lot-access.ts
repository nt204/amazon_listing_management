import "server-only";

import type { RequestActor } from "@/lib/auth";
import { getAccountingAccess, hasFullAccountingAccess, requireStoreAccess } from "@/lib/accounting/access";

/** Store được xem phần FBA (CHI TIẾT ĐI HÀNG). null = mọi store (Admin / Kế toán). */
export async function fulfillStoreScope(actor: RequestActor): Promise<string[] | null> {
  if (hasFullAccountingAccess(actor)) return null;
  const access = await getAccountingAccess(actor);
  return [...access.stores.entries()].filter(([, s]) => s.channels.includes("FBA")).map(([id]) => id);
}

/**
 * Đi hàng theo store team: người có quyền Đi hàng + store FBA thuộc team mình là được xem, tạo, sửa / xoá lô chưa đi hàng.
 * KHÔNG đòi quyền sửa Kế toán (can_edit) — tạo yêu cầu đi hàng là việc của team phụ trách store.
 */
export const requireFulfillStore = (actor: RequestActor, storeId: string) =>
  requireStoreAccess(actor, storeId, "FBA", "read");
