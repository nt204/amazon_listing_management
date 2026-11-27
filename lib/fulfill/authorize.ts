import "server-only";

import { ApiError, authorize } from "@/lib/api-guard";
import type { Permission } from "@/lib/auth";
import { canAccessFulfill, canManageFulfill } from "./access";

/** Đi hàng: quyền mục Kế toán. Dữ liệu từng store kiểm tra thêm ở route (requireFulfillStore / fulfillStoreScope). */
export async function authorizeFulfill(request: Request, permission: Permission) {
  const actor = await authorize(request, permission, "accounting");
  if (!canAccessFulfill(actor)) throw new ApiError("You do not have access to Fulfill.", 403);
  return actor;
}

/** Chỉ Admin / Kế toán: quản lý tài khoản xưởng, các bảng Đi hàng cũ chưa lọc theo store (PO, SKU master, Suppliers cũ). */
export async function authorizeFulfillManager(request: Request, permission: Permission) {
  const actor = await authorizeFulfill(request, permission);
  if (!canManageFulfill(actor)) throw new ApiError("Only Admin or Accountant can do this.", 403);
  return actor;
}
