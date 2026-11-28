import "server-only";

import type postgres from "postgres";
import { getDatabaseClient } from "@/lib/db";
import { ApiError } from "@/lib/api-guard";
import { isLotEditField, LOT_COLUMNS, LOT_EDIT_FIELDS } from "./lot-columns";
import { lineTotals } from "./lot-create";
import { FULFILL_LOT_DELETED, hasShipmentEvidence, inboundSheetLockKey, lotNameOf, shipmentIdOf } from "./lot-state";
import type { FulfillLot, FulfillLotLine, FulfillLotStage } from "./types";

// Đợt hàng = các dòng CHI TIẾT ĐI HÀNG (accounting_inbound_shipments) cùng store + Tên lô.
// Không có bảng riêng: mọi số liệu lấy thẳng từ dữ liệu server mà kế toán / đồng bộ sheet / auto-check đang cập nhật.

export const LOT_STAGE_ORDER: FulfillLotStage[] = ["waiting", "in_transit", "receiving", "closed"];

export interface RawRow {
  id: string;
  store_id: string;
  store_name: string;
  row_order: number;
  updated_at: string;
  brand: string | null;
  sup: string | null;
  ngay_request: string | null;
  product_type: string | null;
  mockup: string | null;
  sku: string;
  quantity: number;
  line_ship: string | null;
  base_cost_per_unit: number | null;
  card: number | null;
  tag: number | null;
  shipping_fee: number | null;
  hop_tui: number | null;
  final_basecost: number | null;
  total_basecost: number | null;
  ten_lo_hang: string | null;
  shipment_id: string | null;
  ngay_di: string | null;
  ngay_den: string | null;
  amazon_received: number | null;
  status: string | null;
  so_luong_amazon_nhan: number | null;
  ngay_thanh_toan: string | null;
  note: string | null;
  trang_thai: string | null;
  kich_thuoc: string | null;
  file_design: string | null;
  fnsku: string | null;
  sku_mockup: string | null;
  custom_fields: Record<string, unknown> | null;
  source: string | null;
  cs_shipment: string | null;
  cs_status: string | null;
  units_expected: number | null;
  units_located: number | null;
  /** Chỉ có ở loadRows nội bộ (view của xưởng không có) */
  created_at?: string | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
}

const clean = (value: string | null | undefined) => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

const fold = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();

/** Shipment ID thật (bỏ ô trống, "x"). */
function shipmentOf(row: RawRow): string | null {
  return shipmentIdOf(row.shipment_id);
}

/**
 * Giai đoạn của 1 dòng: theo status Check Shipment Amazon (mới nhất) hoặc cột Status
 * trên sheet → có Shipment ID / Ngày đi thì đang đi → còn lại là chờ xưởng gửi.
 */
function stageOf(row: RawRow): FulfillLotStage {
  // Cột Trạng thái (Phát triển / Test / Hủy) là trạng thái SKU lấy từ Bảng Mã, KHÔNG phải lô bị hủy:
  // SKU "Hủy" vẫn có thể đã sản xuất, ship và trả tiền. Chỉ shipment Amazon bị hủy mới tính là hủy.
  const status = fold(row.cs_status ?? row.status);
  if (status === "closed") return "closed";
  if (status === "receiving" || status === "checked-in" || status === "checked in") return "receiving";
  if (status === "cancelled" || status === "canceled" || status === "deleted") return "cancelled";
  if (shipmentOf(row) || clean(row.ngay_di)) return "in_transit";
  return "waiting";
}

/** Thành tiền 1 dòng = cột Real total (total_basecost); trống thì Final basecost × Quantity. */
function realTotal(row: RawRow): number {
  if (row.total_basecost != null) return Number(row.total_basecost);
  if (row.final_basecost != null) return Math.round(Number(row.final_basecost) * Number(row.quantity || 0) * 100) / 100;
  return 0;
}

export const lotKey = (storeId: string, lotName: string) => `${storeId}|${lotName}`;

async function loadRows(storeIds: string[] | null): Promise<RawRow[]> {
  const sql = await getDatabaseClient();
  return sql<RawRow[]>`
    WITH cs AS (
      SELECT DISTINCT ON (store_id, upper(btrim(shipment_id)))
        store_id, upper(btrim(shipment_id)) AS sid, status, units_expected, units_located
      FROM accounting_amazon_check_shipments
      WHERE deleted_at IS NULL
        AND (${storeIds === null} OR store_id = ANY(${storeIds ?? []}::uuid[]))
      ORDER BY store_id, upper(btrim(shipment_id)), updated_at DESC
    )
    SELECT
      i.id, i.store_id, st.name AS store_name, i.row_order, i.updated_at::text,
      i.brand, i.sup, i.ngay_request, i.product_type, i.mockup, i.sku, i.quantity, i.line_ship,
      i.base_cost_per_unit::float, i.card::float, i.tag::float, i.shipping_fee::float, i.hop_tui::float,
      i.final_basecost::float, i.total_basecost::float,
      i.ten_lo_hang, i.shipment_id, i.ngay_di, i.ngay_den, i.status, i.amazon_received, i.so_luong_amazon_nhan,
      i.ngay_thanh_toan, i.note, i.trang_thai, i.custom_fields, i.source,
      to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      i.created_by_user_id, i.created_by_name,
      sm.kich_thuoc, sm.file_design, sm.fnsku, sm.mockup_url AS sku_mockup,
      cs.sid AS cs_shipment, cs.status AS cs_status, cs.units_expected, cs.units_located
    FROM accounting_inbound_shipments i
    JOIN stores st ON st.id = i.store_id
    LEFT JOIN accounting_sku_master sm
      ON sm.store_id = i.store_id AND sm.sku = i.sku AND sm.deleted_at IS NULL
    LEFT JOIN cs ON cs.store_id = i.store_id AND cs.sid = upper(btrim(i.shipment_id))
    WHERE i.deleted_at IS NULL
      AND (${storeIds === null} OR i.store_id = ANY(${storeIds ?? []}::uuid[]))
    ORDER BY i.store_id, i.ngay_request, i.row_order, i.created_at
  `;
}

function emptyStageCounts(): Record<FulfillLotStage, number> {
  return { waiting: 0, in_transit: 0, receiving: 0, closed: 0, cancelled: 0 };
}

function rowMatches(row: RawRow, lotName: string, needle: string) {
  return [lotName, row.sku, row.shipment_id, row.sup, row.store_name].some((v) => fold(v).includes(needle));
}

/**
 * Danh sách đợt hàng. `storeIds` = null nghĩa là mọi store (quyền kế toán đầy đủ).
 * Lọc theo Sup / từ khoá (tên lô, SKU, Shipment ID) ở mức dòng: đợt có ít nhất 1 dòng khớp.
 */
export async function listFulfillLots(filters: {
  storeIds: string[] | null;
  storeId?: string;
  sup?: string;
  search?: string;
}): Promise<{ lots: FulfillLot[]; sups: string[] }> {
  const scope = filters.storeId
    ? filters.storeIds === null || filters.storeIds.includes(filters.storeId)
      ? [filters.storeId]
      : []
    : filters.storeIds;
  if (scope && scope.length === 0) return { lots: [], sups: [] };

  const rows = await loadRows(scope);
  const supFilter = fold(filters.sup);
  const needle = fold(filters.search);

  const supNames = new Map<string, string>();
  const groups = new Map<string, { name: string; generated: boolean; rows: RawRow[]; matched: boolean }>();
  for (const row of rows) {
    const sup = clean(row.sup);
    if (sup && !supNames.has(fold(sup))) supNames.set(fold(sup), sup);
    const { name, generated } = lotNameOf(row);
    const key = lotKey(row.store_id, name);
    const group = groups.get(key) ?? { name, generated, rows: [], matched: false };
    group.rows.push(row);
    if ((!supFilter || fold(row.sup) === supFilter) && (!needle || rowMatches(row, name, needle))) group.matched = true;
    groups.set(key, group);
  }

  const lots: FulfillLot[] = [];
  for (const [key, group] of groups) {
    if (group.matched) lots.push(summarizeLot(key, group.name, group.generated, group.rows));
  }

  lots.sort((a, b) => (b.first_request ?? "").localeCompare(a.first_request ?? "") || a.lot_name.localeCompare(b.lot_name));
  return { lots, sups: [...supNames.values()].sort((a, b) => a.localeCompare(b)) };
}

const extraText = (row: RawRow, field: string) => {
  const value = row.custom_fields?.[field];
  return value === null || value === undefined ? null : clean(String(value));
};
const extraNumber = (row: RawRow, field: string) => {
  const value = Number(row.custom_fields?.[field]);
  return row.custom_fields?.[field] == null || !Number.isFinite(value) ? null : value;
};

/** 1 dòng CHI TIẾT ĐI HÀNG → 1 dòng của sheet gửi xưởng (dùng cho trang nội bộ và trang xưởng /sup). */
export function toLotLine(row: RawRow): FulfillLotLine {
  return {
    id: row.id,
    row_order: row.row_order,
    name: clean(row.brand)?.toUpperCase() ?? row.store_name,
    sup: clean(row.sup),
    ngay_request: clean(row.ngay_request),
    order_date: extraText(row, "order_date"),
    product_type: clean(row.product_type),
    mockup: clean(row.mockup) ?? clean(row.sku_mockup),
    sku: row.sku,
    quantity: Number(row.quantity || 0),
    quantity_request: extraNumber(row, "quantity_request"),
    line_ship: clean(row.line_ship),
    dimensions: Object.hasOwn(row.custom_fields ?? {}, "dimensions") ? extraText(row, "dimensions") : clean(row.kich_thuoc),
    base_cost_per_unit: row.base_cost_per_unit,
    stand_fee: extraNumber(row, "stand_fee"),
    card: row.card,
    tag: row.tag,
    shipping_fee: row.shipping_fee,
    hop_tui: row.hop_tui,
    final_basecost: row.final_basecost,
    real_total: realTotal(row),
    file_design: Object.hasOwn(row.custom_fields ?? {}, "design") ? extraText(row, "design") : clean(row.file_design),
    card_design: extraText(row, "card_design"),
    card_back: extraText(row, "card_back"),
    thankyou_card: extraText(row, "thankyou_card"),
    tag_design: extraText(row, "tag_design"),
    box_design: extraText(row, "box_design"),
    box_quantity: extraNumber(row, "box_quantity"),
    source: row.source,
    transparency_code: extraText(row, "transparency_code"),
    fnsku: extraText(row, "fnsku") ?? clean(row.fnsku),
    label_fnsku: extraText(row, "label_fnsku"),
    check_ship: extraText(row, "check_ship"),
    box_count: extraNumber(row, "box_count"),
    shipping_label: extraText(row, "shipping_label"),
    shipping_address: extraText(row, "shipping_address"),
    replacement_fee: extraNumber(row, "replacement_fee"),
    request: extraText(row, "request"),
    sample_link: extraText(row, "sample_link"),
    label_link: extraText(row, "label_link"),
    package_link: extraText(row, "package_link"),
    check_final: extraText(row, "check_final"),
    shipment_id: shipmentOf(row),
    ngay_di: clean(row.ngay_di),
    ngay_den: clean(row.ngay_den),
    status: clean(row.cs_status) ?? clean(row.status),
    so_luong_amazon_nhan: row.so_luong_amazon_nhan,
    ngay_thanh_toan: clean(row.ngay_thanh_toan),
    note: clean(row.note),
    trang_thai: clean(row.trang_thai),
    stage: stageOf(row),
  };
}

/** Các dòng của 1 đợt, đúng thứ tự cột của sheet gửi xưởng. */
export async function getFulfillLot(
  storeId: string,
  lotName: string,
): Promise<{ lot: FulfillLot; lines: FulfillLotLine[]; unshipped: boolean; unpaid: boolean; hasExplicitLotName: boolean; versions: Record<string, string> } | null> {
  const rows = await loadRows([storeId]);
  const lotRows = rows.filter((row) => lotNameOf(row).name === lotName);
  if (lotRows.length === 0) return null;

  const lot = summarizeLot(lotKey(storeId, lotName), lotName, lotNameOf(lotRows[0]).generated, lotRows);
  const lines = lotRows.map(toLotLine);
  return {
    lot,
    lines,
    unshipped: !lotRows.some(hasShipmentEvidence),
    unpaid: !lotRows.some((row) => clean(row.ngay_thanh_toan)),
    hasExplicitLotName: lotRows.every((row) => !lotNameOf(row).generated),
    versions: Object.fromEntries(lotRows.map((row) => [row.id, row.updated_at])),
  };
}

/** Khoá các dòng của lô để sửa / xoá. `requireUnshipped`: chặn khi lô đã có hoạt động đi hàng (dùng khi xoá). */
async function lockLot(tx: postgres.TransactionSql, storeId: string, lotName: string, requireUnshipped: boolean) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${inboundSheetLockKey(storeId)}))`;
  const candidates = await tx<Pick<RawRow, "id" | "ten_lo_hang" | "sup" | "ngay_request">[]>`
    SELECT id, ten_lo_hang, sup, ngay_request
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId} AND deleted_at IS NULL
  `;
  const ids = candidates.filter((row) => lotNameOf(row).name === lotName).map((row) => row.id);
  if (!ids.length) throw new ApiError("Shipment lot not found.", 404);

  const rows = await tx<Pick<RawRow, "id" | "ten_lo_hang" | "sup" | "ngay_request" | "ngay_thanh_toan" | "shipment_id" | "ngay_di" | "ngay_den" | "status" | "amazon_received" | "so_luong_amazon_nhan" | "updated_at" | "custom_fields" | "quantity" | "base_cost_per_unit" | "card" | "tag" | "hop_tui" | "final_basecost" | "total_basecost">[]>`
    SELECT id, ten_lo_hang, sup, ngay_request, ngay_thanh_toan, shipment_id, ngay_di, ngay_den, status, amazon_received, so_luong_amazon_nhan,
      updated_at::text, custom_fields, quantity, base_cost_per_unit::float, card::float, tag::float, hop_tui::float,
      final_basecost::float, total_basecost::float
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId} AND id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
    ORDER BY id
    FOR UPDATE
  `;
  if (rows.length !== ids.length || rows.some((row) => lotNameOf(row).name !== lotName)) {
    throw new ApiError("This lot changed. Reopen it and try again.", 409);
  }
  if (requireUnshipped && rows.some(hasShipmentEvidence)) {
    throw new ApiError("This lot cannot be deleted because at least one line has shipment activity.", 409);
  }
  return rows;
}

export async function deleteUnshippedFulfillLot(storeId: string, lotName: string, changedBy: string): Promise<number> {
  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    const rows = await lockLot(tx, storeId, lotName, true);
    // Đã thanh toán (có Ngày thanh toán) thì không xoá — giữ chứng từ công nợ
    if (rows.some((row) => clean(row.ngay_thanh_toan))) {
      throw new ApiError("This lot cannot be deleted because it has been paid.", 409);
    }
    const ids = rows.map((row) => row.id);
    const deleted = await tx`
      UPDATE accounting_inbound_shipments
      SET deleted_at = NOW(), updated_at = NOW(), last_changed_by = ${changedBy},
          custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object(${FULFILL_LOT_DELETED}::text, true)
      WHERE store_id = ${storeId} AND id = ANY(${ids}::uuid[])
      RETURNING id
    `;
    return deleted.length;
  });
}

function parseEditableValue(field: keyof typeof LOT_EDIT_FIELDS, input: string) {
  const column = LOT_COLUMNS.find((entry) => entry.key === field)!;
  const text = input.trim();
  if (column.kind === "int" || column.kind === "money") {
    if (!text && field !== "quantity") return null;
    const numeric = Number(text);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text) || numeric > 1_000_000 ||
        (column.kind === "int" && !Number.isInteger(numeric)) || (field === "quantity" && numeric < 1)) {
      throw new ApiError(`Enter a valid number for ${column.header}.`, 400);
    }
    return numeric;
  }
  if (column.kind === "date" && text) {
    const date = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
      throw new ApiError(`Enter a valid date for ${column.header}.`, 400);
    }
  }
  if (column.kind === "link" && text && !URL.canParse(text)) {
    throw new ApiError(`Enter a full URL for ${column.header}.`, 400);
  }
  if (column.kind === "link" && text && !["http:", "https:"].includes(new URL(text).protocol)) {
    throw new ApiError(`Enter an HTTP or HTTPS URL for ${column.header}.`, 400);
  }
  return text || null;
}

export async function updateFulfillLot(
  storeId: string,
  lotName: string,
  edits: { id: string; version: string; fields: Record<string, string> }[],
  changedBy: string,
) {
  const sql = await getDatabaseClient();
  await sql.begin(async (tx) => {
    // Team sửa được cả bảng kể cả khi lô đã đi hàng (phần đóng gói / vận chuyển điền sau khi gửi)
    const rows = await lockLot(tx, storeId, lotName, false);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const generated = rows.some((row) => lotNameOf(row).generated);
    for (const edit of edits) {
      const row = byId.get(edit.id);
      if (!row || row.updated_at !== edit.version) {
        throw new ApiError("This lot changed. Reopen it before editing again.", 409);
      }
      const values: Record<string, string | number | null> = {};
      const custom: Record<string, string | number | null> = {};
      for (const [field, input] of Object.entries(edit.fields)) {
        if (!isLotEditField(field) || (generated && (field === "sup" || field === "ngay_request"))) {
          throw new ApiError("This field cannot be edited for this lot.", 400);
        }
        const value = parseEditableValue(field, input);
        if (LOT_EDIT_FIELDS[field] === "custom") custom[field === "file_design" ? "design" : field] = value;
        else values[field] = value;
      }
      const feeChanged = ["base_cost_per_unit", "card", "tag", "hop_tui"].some((field) => Object.hasOwn(values, field)) ||
        Object.hasOwn(custom, "stand_fee");
      if (feeChanged || Object.hasOwn(values, "quantity")) {
        const fee = (field: "base_cost_per_unit" | "card" | "tag" | "hop_tui") =>
          Object.hasOwn(values, field) ? Number(values[field]) : row[field];
        const quantity = Number(values.quantity ?? row.quantity);
        const { final, total } = lineTotals({
          quantity,
          base_cost_per_unit: fee("base_cost_per_unit"),
          card: fee("card"),
          tag: fee("tag"),
          hop_tui: fee("hop_tui"),
          stand_fee: Number(Object.hasOwn(custom, "stand_fee") ? custom.stand_fee : row.custom_fields?.stand_fee) || 0,
        });
        if (feeChanged) {
          values.final_basecost = final;
          values.total_basecost = total;
        } else {
          const rate = row.final_basecost ?? (row.total_basecost !== null && row.quantity > 0 ? row.total_basecost / row.quantity : final);
          values.total_basecost = Math.round(rate * quantity * 100) / 100;
        }
      }
      const changes = {
        ...values,
        ...(Object.keys(custom).length ? { custom_fields: tx.json({ ...row.custom_fields, ...custom } as never) } : {}),
        last_changed_by: changedBy,
      };
      await tx`
        UPDATE accounting_inbound_shipments SET ${tx(changes)}, updated_at = NOW()
        WHERE store_id = ${storeId} AND id = ${edit.id}
      `;
    }
  });
}

/** Tổng hợp 1 đợt: không tính dòng có shipment Amazon bị hủy vào số lượng / tiền; giai đoạn đợt = giai đoạn chậm nhất còn lại. */
export function summarizeLot(key: string, name: string, generated: boolean, rows: RawRow[]): FulfillLot {
  const first = rows[0];
  const stageCounts = emptyStageCounts();
  const skus = new Set<string>();
  const sups = new Map<string, number>();
  const shipments = new Map<string, { expected: number; located: number }>();
  const requests: string[] = [];
  let quantity = 0;
  let amount = 0;
  let paid = 0;
  // Người tạo = dòng tạo sớm nhất có ghi người tạo (yêu cầu tạo từ web Fulfill)
  let creator: RawRow | null = null;

  for (const row of rows) {
    if (row.created_by_user_id && (!creator || (row.created_at ?? "") < (creator.created_at ?? ""))) creator = row;
    const stage = stageOf(row);
    stageCounts[stage] += 1;
    if (stage === "cancelled") continue;
    skus.add(row.sku.trim().toUpperCase());
    const sup = clean(row.sup);
    if (sup) sups.set(sup, (sups.get(sup) ?? 0) + 1);
    const request = clean(row.ngay_request);
    if (request) requests.push(request);
    quantity += Number(row.quantity || 0);
    const total = realTotal(row);
    amount += total;
    if (clean(row.ngay_thanh_toan)) paid += total;
    const sid = shipmentOf(row)?.toUpperCase();
    if (sid && !shipments.has(sid)) {
      shipments.set(sid, {
        expected: row.cs_shipment ? Number(row.units_expected || 0) : 0,
        located: row.cs_shipment ? Number(row.units_located || 0) : 0,
      });
    }
  }

  requests.sort();
  return {
    key,
    lot_name: name,
    lot_name_generated: generated,
    store_id: first.store_id,
    store_name: first.store_name,
    sup: [...sups.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? clean(first.sup),
    first_request: requests[0] ?? null,
    last_request: requests[requests.length - 1] ?? null,
    sku_count: skus.size,
    quantity,
    amount: Math.round(amount * 100) / 100,
    paid_amount: Math.round(paid * 100) / 100,
    shipment_ids: [...shipments.keys()],
    units_expected: [...shipments.values()].reduce((a, s) => a + s.expected, 0),
    units_located: [...shipments.values()].reduce((a, s) => a + s.located, 0),
    stage: LOT_STAGE_ORDER.find((stage) => stageCounts[stage] > 0) ?? "cancelled",
    stage_counts: stageCounts,
    created_by_user_id: creator?.created_by_user_id ?? null,
    created_by_name: creator?.created_by_name ?? null,
    created_at: creator?.created_at ?? null,
  };
}
