// Store PPC đặt tên khác store kế toán / Bảng mã. Dùng được cả phía client lẫn server.
export const PPC_TO_ACCOUNTING_STORE_NAME_MAP: Record<string, string> = {
  HSOSTORE: "WARMSTOREY",
};

/** Tên store PPC → tên store bên kế toán / Bảng mã (viết hoa). */
export function accountingNameOfPpcStore(ppcName: string): string {
  const upper = ppcName.trim().toUpperCase();
  return PPC_TO_ACCOUNTING_STORE_NAME_MAP[upper] || upper;
}

/** Store PPC ứng với store trong Bảng mã: trùng tên, hoặc khớp qua bảng đổi tên (WARMSTOREY → HSOSTORE). */
export function findPpcStoreForAccountingName<T extends { name: string }>(ppcStores: T[], accountingName: string): T | undefined {
  const want = accountingName.trim().toUpperCase();
  if (!want) return undefined;
  return ppcStores.find((st) => st.name.trim().toUpperCase() === want) ?? ppcStores.find((st) => accountingNameOfPpcStore(st.name) === want);
}
