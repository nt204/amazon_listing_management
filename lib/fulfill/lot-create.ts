import "server-only";

import { z } from "zod";
import { ApiError } from "@/lib/api-guard";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { getDatabaseClient } from "@/lib/db";
import { inboundSheetLockKey } from "./lot-state";

// Tạo yêu cầu đi hàng: ghi thẳng các dòng vào CHI TIẾT ĐI HÀNG (accounting_inbound_shipments) với source = 'fulfill'
// (đồng bộ Google Sheet không xóa các dòng này). Cột giống tab gửi xưởng "FBA BFF November 26 - Everphant":
//   Final Basecost = Real basecost + Card fee + Tag fee + Stand fee + box/bag fee
//   Real total     = Final Basecost × Quantity/add
// Cột CHI TIẾT ĐI HÀNG không có (Quantity yêu cầu, Stand fee, link card/tag/box, one box quantity…) lưu ở custom_fields.

/** Danh sách chọn giống data validation của sheet gửi xưởng. */
export const SHEET_SUPS = ["Ella", "Gearment", "VIC", "Printway", "Merchize", "One Hundred", "ATD", "Hoài Crochet", "chị Nga sỏi", "Vân Canh", "BFF"];
export const SHEET_LINE_SHIPS = ["SEA", "UPS", "UPS (AMZ)", "AIR", "SEA 15 DAYS", "SEA 20 DAYS", "Fedex"];

/** Trường lưu trong custom_fields của dòng CHI TIẾT ĐI HÀNG. */
export const LOT_EXTRA_FIELDS = [
  "quantity_request",
  "dimensions",
  "stand_fee",
  "design",
  "card_design",
  "card_back",
  "thankyou_card",
  "tag_design",
  "box_design",
  "box_quantity",
] as const;

export interface LotSkuOption {
  sku: string;
  /** Trạng thái SKU trong Bảng Mã: Phát triển / Test / Hủy */
  status: string | null;
  product_type: string | null;
  mockup: string | null;
  dimensions: string | null;
  design: string | null;
  fnsku: string | null;
  basecost_tb: number | null;
  /** Lần đặt gần nhất của SKU (để điền sẵn giá / link như sheet cũ) */
  last: {
    sup: string | null;
    line_ship: string | null;
    base_cost_per_unit: number | null;
    card: number | null;
    tag: number | null;
    hop_tui: number | null;
    custom_fields: Record<string, unknown>;
    ngay_request: string | null;
  } | null;
}

export async function getLotFormOptions(storeId: string) {
  const sql = await getDatabaseClient();
  const [skus, sups, lineShips, types, lots] = await Promise.all([
    sql<(Omit<LotSkuOption, "last"> & { last: LotSkuOption["last"] })[]>`
      SELECT
        sm.sku, sm.status, sm.product_type, COALESCE(sm.mockup_url, sm.mockup) AS mockup, sm.kich_thuoc AS dimensions,
        sm.file_design AS design, sm.fnsku, sm.basecost_tb::float,
        (
          SELECT json_build_object(
            'sup', i.sup, 'line_ship', i.line_ship, 'base_cost_per_unit', i.base_cost_per_unit::float,
            'card', i.card::float, 'tag', i.tag::float, 'hop_tui', i.hop_tui::float,
            'custom_fields', i.custom_fields, 'ngay_request', i.ngay_request
          )
          FROM accounting_inbound_shipments i
          WHERE i.store_id = sm.store_id AND lower(btrim(i.sku)) = lower(btrim(sm.sku)) AND i.deleted_at IS NULL
          ORDER BY i.ngay_request DESC NULLS LAST, i.created_at DESC
          LIMIT 1
        ) AS last
      FROM accounting_sku_master sm
      WHERE sm.store_id = ${storeId} AND sm.deleted_at IS NULL
      ORDER BY sm.sku
    `,
    sql<{ v: string }[]>`
      SELECT DISTINCT btrim(sup) AS v FROM accounting_inbound_shipments
      WHERE deleted_at IS NULL AND NULLIF(btrim(sup), '') IS NOT NULL`,
    sql<{ v: string }[]>`
      SELECT btrim(line_ship) AS v FROM accounting_inbound_shipments
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND NULLIF(btrim(line_ship), '') IS NOT NULL
      GROUP BY 1 ORDER BY max(ngay_request) DESC NULLS LAST LIMIT 12`,
    sql<{ v: string }[]>`
      SELECT DISTINCT btrim(product_type) AS v FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND NULLIF(btrim(product_type), '') IS NOT NULL`,
    sql<{ v: string }[]>`
      SELECT DISTINCT btrim(ten_lo_hang) AS v FROM accounting_inbound_shipments
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND NULLIF(btrim(ten_lo_hang), '') IS NOT NULL`,
  ]);

  const uniq = (values: string[]) => {
    const seen = new Map<string, string>();
    for (const v of values) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    return [...seen.values()];
  };
  return {
    skus: skus as LotSkuOption[],
    sups: uniq([...SHEET_SUPS, ...sups.map((r) => r.v)]).sort((a, b) => a.localeCompare(b)),
    lineShips: uniq([...lineShips.map((r) => r.v), ...SHEET_LINE_SHIPS]),
    types: uniq(types.map((r) => r.v)).sort((a, b) => a.localeCompare(b)),
    existingLots: lots.map((r) => r.v),
  };
}

const money = z.coerce.number().min(0).max(100_000).nullable().optional();
const textField = z.string().trim().max(2000).nullable().optional();

export const createLotSchema = z.object({
  store_id: z.string().uuid(),
  sup: z.string().trim().min(1, "Choose a supplier").max(100),
  ngay_request: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Request date must be YYYY-MM-DD"),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ten_lo_hang: z.string().trim().min(3, "Enter a lot name").max(200),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(100),
        product_type: textField,
        mockup: textField,
        quantity_request: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
        quantity: z.coerce.number().int().min(1, "Actual quantity must be at least 1").max(1_000_000),
        line_ship: textField,
        dimensions: textField,
        base_cost_per_unit: money,
        note: textField,
        card: money,
        tag: money,
        stand_fee: money,
        hop_tui: money,
        design: textField,
        card_design: textField,
        card_back: textField,
        thankyou_card: textField,
        tag_design: textField,
        box_design: textField,
        box_quantity: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
      }),
    )
    .min(1, "Add at least one SKU")
    .max(500),
});

export type CreateLotInput = z.infer<typeof createLotSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Final Basecost & Real total đúng công thức sheet gửi xưởng. */
export function lineTotals(line: Pick<CreateLotInput["lines"][number], "base_cost_per_unit" | "card" | "tag" | "stand_fee" | "hop_tui" | "quantity">) {
  const final = round2(
    [line.base_cost_per_unit, line.card, line.tag, line.stand_fee, line.hop_tui].reduce<number>((a, v) => a + (Number(v) || 0), 0),
  );
  return { final, total: round2(final * line.quantity) };
}

export async function createFulfillLot(input: CreateLotInput, actor: string) {
  const store = await getStoreById(input.store_id);
  if (!store) throw new ApiError("Store not found.", 404);

  const seen = new Set<string>();
  for (const line of input.lines) {
    const key = line.sku.toLowerCase();
    if (seen.has(key)) throw new ApiError(`SKU ${line.sku} appears twice. Combine the quantities into one row.`, 400);
    seen.add(key);
  }

  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${inboundSheetLockKey(input.store_id)}))`;
    const lotName = input.ten_lo_hang.trim();
    const skuList = input.lines.map((l) => l.sku.toLowerCase());

    // Cùng SKU + Tên lô chỉ được 1 dòng (ràng buộc uq_accounting_inbound_active_identity)
    const clash = await tx<{ sku: string }[]>`
      SELECT sku FROM accounting_inbound_shipments
      WHERE store_id = ${input.store_id} AND deleted_at IS NULL
        AND lower(btrim(ten_lo_hang)) = lower(${lotName})
        AND lower(btrim(sku)) = ANY(${skuList}::text[])
    `;
    if (clash.length) {
      throw new ApiError(`Lot "${lotName}" already contains: ${clash.map((r) => r.sku).join(", ")}. Edit the existing rows.`, 409);
    }

    const master = await tx<{ id: string; sku: string; status: string | null }[]>`
      SELECT id, sku, status FROM accounting_sku_master
      WHERE store_id = ${input.store_id} AND deleted_at IS NULL AND lower(btrim(sku)) = ANY(${skuList}::text[])
    `;
    const masterId = new Map(master.map((m) => [m.sku.trim().toLowerCase(), m]));
    const missing = input.lines.filter((l) => !masterId.has(l.sku.toLowerCase())).map((l) => l.sku);
    if (missing.length) throw new ApiError(`Not in the SKU Master for ${store.name}: ${missing.join(", ")}.`, 400);

    const [{ next_order }] = await tx<{ next_order: number }[]>`
      SELECT COALESCE(MAX(row_order), 0) + 1 AS next_order FROM accounting_inbound_shipments WHERE store_id = ${input.store_id}
    `;

    const ids: string[] = [];
    for (const [index, line] of input.lines.entries()) {
      const m = masterId.get(line.sku.toLowerCase())!;
      const { final, total } = lineTotals(line);
      const custom: Record<string, unknown> = {};
      if (input.order_date) custom.order_date = input.order_date;
      for (const field of LOT_EXTRA_FIELDS) {
        const value = line[field];
        if (value !== null && value !== undefined && value !== "") custom[field] = value;
      }
      const values = {
        store_id: input.store_id,
        sku_id: m.id,
        brand: store.name,
        sup: input.sup,
        ngay_request: input.ngay_request,
        product_type: line.product_type || null,
        mockup: line.mockup || null,
        sku: m.sku,
        quantity: line.quantity,
        line_ship: line.line_ship || null,
        base_cost_per_unit: line.base_cost_per_unit ?? null,
        card: line.card ?? null,
        tag: line.tag ?? null,
        hop_tui: line.hop_tui ?? null,
        final_basecost: final,
        total_basecost: total,
        ten_lo_hang: lotName,
        note: line.note || null,
        // Trạng thái (Phát triển / Test / Hủy) = cột status của Bảng Mã, như XLOOKUP trên sheet CHI TIẾT ĐI HÀNG
        trang_thai: m.status?.trim() || "Phát triển",
        custom_fields: tx.json(custom as never),
        source: "fulfill",
        row_order: next_order + index,
        last_changed_by: actor,
      };
      const [row] = await tx<{ id: string }[]>`INSERT INTO accounting_inbound_shipments ${tx(values)} RETURNING id`;
      ids.push(row.id);
    }
    return { ids, lotName, storeId: input.store_id };
  });
}
