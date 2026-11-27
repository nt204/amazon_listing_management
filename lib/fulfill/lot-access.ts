import "server-only";

import type { RequestActor } from "@/lib/auth";
import { getAccountingAccess, hasFullAccountingAccess, requireStoreAccess } from "@/lib/accounting/access";

/** Store được xem phần FBA (CHI TIẾT ĐI HÀNG). null = mọi store (Admin / Kế toán). */
export async function fulfillStoreScope(actor: RequestActor): Promise<string[] | null> {
  if (hasFullAccountingAccess(actor)) return null;
  const access = await getAccountingAccess(actor);
  return [...access.stores.entries()].filter(([, s]) => s.channels.includes("FBA")).map(([id]) => id);
}

export const requireFulfillStore = (actor: RequestActor, storeId: string, mode: "read" | "write" = "read") =>
  requireStoreAccess(actor, storeId, "FBA", mode);
