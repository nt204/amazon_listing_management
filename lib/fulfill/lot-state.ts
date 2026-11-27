interface LotIdentity {
  ten_lo_hang?: unknown;
  sup?: unknown;
  ngay_request?: unknown;
}

interface ShipmentFields {
  shipment_id?: unknown;
  ngay_di?: unknown;
  ngay_den?: unknown;
  status?: unknown;
  amazon_received?: unknown;
  so_luong_amazon_nhan?: unknown;
}

const trim = (value: unknown) => typeof value === "string" ? value.trim() : "";
const shippedStatuses = new Set([
  "shipped", "in transit", "receiving", "checked in", "delivered", "closed", "received",
]);

export const FULFILL_LOT_DELETED = "fulfill_lot_deleted";
export const inboundSheetLockKey = (storeId: string) => `inventory-sheet-sync:${storeId}:inbound`;

export function lotNameOf(row: LotIdentity): { name: string; generated: boolean } {
  const name = trim(row.ten_lo_hang);
  if (name) return { name, generated: false };
  return { name: `FBA ${trim(row.sup) || "?"} ${trim(row.ngay_request) || "chưa có ngày"}`, generated: true };
}

export function shipmentIdOf(value: unknown): string | null {
  const id = trim(value);
  return id && id.toLowerCase() !== "x" ? id : null;
}

export function hasShipmentEvidence(row: ShipmentFields): boolean {
  const status = trim(row.status).toLowerCase().replace(/[-_]+/g, " ");
  return Boolean(
    shipmentIdOf(row.shipment_id) || trim(row.ngay_di) || trim(row.ngay_den) ||
    shippedStatuses.has(status) || Number(row.amazon_received) > 0 || Number(row.so_luong_amazon_nhan) > 0,
  );
}
