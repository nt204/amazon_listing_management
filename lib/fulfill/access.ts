// Phân quyền Đi hàng (dùng được cả phía client):
//   - Vào Đi hàng: người có mục Kế toán (Admin / Kế toán / thành viên được bật "accounting").
//     Dữ liệu lô hàng lọc theo store FBA mà team được phân (lib/fulfill/lot-access.ts) — team nào chỉ thấy store của team đó.
//   - Quản lý tài khoản xưởng, SKU master / PO cũ (chưa lọc theo store): chỉ Admin / Kế toán.
//   - Xưởng (trang /sup) không dùng tài khoản nội bộ: chỉ xem lô của Sup được gán (lib/fulfill/sup-db.ts).

type FulfillActor = { role?: string | null; allowedFeatures?: string[] | null } | null | undefined;

export function canManageFulfill(actor: FulfillActor): boolean {
  return actor?.role === "admin" || actor?.role === "accountant";
}

export function canAccessFulfill(actor: FulfillActor): boolean {
  if (!actor) return false;
  return canManageFulfill(actor) || (actor.allowedFeatures ?? []).includes("accounting");
}
