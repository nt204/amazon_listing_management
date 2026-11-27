import "server-only";

import { z } from "zod";
import { ApiError } from "@/lib/api-guard";
import { hasFullAccountingAccess } from "@/lib/accounting/access";
import { authorizeFulfill } from "./authorize";

export const supAccountSchema = z.object({
  email: z.string().trim().min(3).max(200),
  display_name: z.string().trim().max(200).nullable().optional(),
  sup_names: z.array(z.string().trim().min(1).max(100)).max(20),
  is_active: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** Quản lý tài khoản xưởng: chỉ Admin / Kế toán. */
export async function requireSupManager(req: Request, permission: "read" | "write") {
  const actor = await authorizeFulfill(req, permission);
  if (!hasFullAccountingAccess(actor)) throw new ApiError("Only Admin or Accountant can manage supplier accounts.", 403);
  return actor;
}
