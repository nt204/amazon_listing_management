import "server-only";

import { ApiError, authorize } from "@/lib/api-guard";
import type { Permission } from "@/lib/auth";
import { canAccessFulfill } from "./access";

/** Quyền kế toán như cũ, cộng thêm khoá tạm: chỉ email trong FULFILL_ALLOWED_EMAILS. */
export async function authorizeFulfill(request: Request, permission: Permission) {
  const actor = await authorize(request, permission, "accounting");
  if (!canAccessFulfill(actor)) {
    throw new ApiError("Mục Đi hàng đang tạm khoá để phát triển.", 403);
  }
  return actor;
}
