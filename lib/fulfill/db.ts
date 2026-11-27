import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type {
  FulfillDashboardSummary,
  FulfillPo,
  FulfillPoLine,
  FulfillSkuMasterItem,
  FulfillSupplier,
} from "./types";

// ==========================================
// 1. SUPPLIERS
// ==========================================

export async function listFulfillSuppliers(): Promise<FulfillSupplier[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<any[]>`
    SELECT
      s.id,
      s.code,
      s.name,
      s.contact_name,
      s.phone,
      s.email,
      s.address,
      s.is_active,
      s.notes,
      s.created_at::text,
      s.updated_at::text,
      COUNT(p.id)::int as po_count
    FROM fulfill_suppliers s
    LEFT JOIN fulfill_pos p ON p.supplier_id = s.id
    GROUP BY s.id
    ORDER BY s.name ASC
  `;
  return rows.map((r) => ({
    ...r,
    po_count: Number(r.po_count || 0),
  }));
}

export async function upsertFulfillSupplier(data: {
  id?: string;
  code: string;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  is_active?: boolean;
  notes?: string | null;
}): Promise<FulfillSupplier> {
  const sql = await getDatabaseClient();
  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();

  if (data.id) {
    const rows = await sql<FulfillSupplier[]>`
      UPDATE fulfill_suppliers
      SET
        code = ${code},
        name = ${name},
        contact_name = ${data.contact_name || null},
        phone = ${data.phone || null},
        email = ${data.email || null},
        address = ${data.address || null},
        is_active = ${data.is_active ?? true},
        notes = ${data.notes || null},
        updated_at = NOW()
      WHERE id = ${data.id}
      RETURNING
        id, code, name, contact_name, phone, email, address, is_active, notes,
        created_at::text, updated_at::text
    `;
    return rows[0];
  } else {
    const rows = await sql<FulfillSupplier[]>`
      INSERT INTO fulfill_suppliers (
        code, name, contact_name, phone, email, address, is_active, notes
      ) VALUES (
        ${code}, ${name}, ${data.contact_name || null}, ${data.phone || null},
        ${data.email || null}, ${data.address || null}, ${data.is_active ?? true}, ${data.notes || null}
      )
      RETURNING
        id, code, name, contact_name, phone, email, address, is_active, notes,
        created_at::text, updated_at::text
    `;
    return rows[0];
  }
}

// ==========================================
// 2. PRODUCTION ORDERS (POs)
// ==========================================

export async function listFulfillPos(filters: {
  storeId?: string;
  supplierId?: string;
  status?: string;
  search?: string;
}): Promise<{ pos: FulfillPo[]; summary: FulfillDashboardSummary }> {
  const sql = await getDatabaseClient();
  const searchPattern = filters.search ? `%${filters.search.trim().toLowerCase()}%` : null;

  const rows = await sql<any[]>`
    SELECT
      p.id,
      p.po_number,
      p.store_id,
      st.name as store_name,
      p.supplier_id,
      sp.code as supplier_code,
      sp.name as supplier_name,
      p.order_date::text,
      p.target_date::text,
      p.status,
      p.total_quantity,
      p.total_amount::float,
      p.notes,
      p.created_by,
      p.created_at::text,
      p.updated_at::text,
      COUNT(pl.id)::int as line_count
    FROM fulfill_pos p
    LEFT JOIN stores st ON st.id = p.store_id
    LEFT JOIN fulfill_suppliers sp ON sp.id = p.supplier_id
    LEFT JOIN fulfill_po_lines pl ON pl.po_id = p.id
    WHERE (${filters.storeId || null}::uuid IS NULL OR p.store_id = ${filters.storeId || null}::uuid)
      AND (${filters.supplierId || null}::uuid IS NULL OR p.supplier_id = ${filters.supplierId || null}::uuid)
      AND (${filters.status || null}::text IS NULL OR p.status = ${filters.status || null})
      AND (${searchPattern}::text IS NULL OR (
        LOWER(p.po_number) LIKE ${searchPattern}
        OR LOWER(COALESCE(st.name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(sp.name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(p.notes, '')) LIKE ${searchPattern}
      ))
    GROUP BY p.id, st.name, sp.code, sp.name
    ORDER BY p.order_date DESC, p.created_at DESC
  `;

  // Summary counts
  let totalProducing = 0;
  let totalShipped = 0;
  let totalReceived = 0;
  let totalQty = 0;
  let totalAmt = 0;

  for (const r of rows) {
    if (r.status === "producing") totalProducing++;
    else if (r.status === "shipped") totalShipped++;
    else if (r.status === "received") totalReceived++;
    totalQty += Number(r.total_quantity || 0);
    totalAmt += Number(r.total_amount || 0);
  }

  const summary: FulfillDashboardSummary = {
    total_pos: rows.length,
    total_producing: totalProducing,
    total_shipped: totalShipped,
    total_received: totalReceived,
    total_quantity: totalQty,
    total_amount: Math.round(totalAmt * 100) / 100,
  };

  return {
    pos: rows.map((r) => ({
      ...r,
      total_quantity: Number(r.total_quantity || 0),
      total_amount: Number(r.total_amount || 0),
      line_count: Number(r.line_count || 0),
    })),
    summary,
  };
}

export async function getFulfillPoById(poId: string): Promise<{ po: FulfillPo; lines: FulfillPoLine[] } | null> {
  const sql = await getDatabaseClient();

  const poRows = await sql<any[]>`
    SELECT
      p.id,
      p.po_number,
      p.store_id,
      st.name as store_name,
      p.supplier_id,
      sp.code as supplier_code,
      sp.name as supplier_name,
      p.order_date::text,
      p.target_date::text,
      p.status,
      p.total_quantity,
      p.total_amount::float,
      p.notes,
      p.created_by,
      p.created_at::text,
      p.updated_at::text
    FROM fulfill_pos p
    LEFT JOIN stores st ON st.id = p.store_id
    LEFT JOIN fulfill_suppliers sp ON sp.id = p.supplier_id
    WHERE p.id = ${poId}
    LIMIT 1
  `;

  if (!poRows.length) return null;

  const lineRows = await sql<any[]>`
    SELECT
      id,
      po_id,
      row_order,
      product_type,
      sku,
      quantity,
      line_ship,
      dimensions,
      basecost::float,
      fee_card::float,
      fee_tag::float,
      fee_stand::float,
      fee_box::float,
      total_line_cost::float,
      design_url,
      card_url,
      tag_url,
      box_url,
      transparency_code,
      fnsku,
      label_fnsku,
      shipment_id,
      box_quantity,
      shipping_label,
      shipping_address,
      shipping_out_date::text,
      arrival_date::text,
      replacement_fee::float,
      sample_url,
      package_url,
      check_status,
      notes,
      created_at::text,
      updated_at::text
    FROM fulfill_po_lines
    WHERE po_id = ${poId}
    ORDER BY row_order ASC, created_at ASC
  `;

  const po: FulfillPo = {
    ...poRows[0],
    total_quantity: Number(poRows[0].total_quantity || 0),
    total_amount: Number(poRows[0].total_amount || 0),
    line_count: lineRows.length,
  };

  const lines: FulfillPoLine[] = lineRows.map((l) => ({
    ...l,
    quantity: Number(l.quantity || 0),
    basecost: Number(l.basecost || 0),
    fee_card: Number(l.fee_card || 0),
    fee_tag: Number(l.fee_tag || 0),
    fee_stand: Number(l.fee_stand || 0),
    fee_box: Number(l.fee_box || 0),
    total_line_cost: Number(l.total_line_cost || 0),
    box_quantity: l.box_quantity != null ? Number(l.box_quantity) : null,
    replacement_fee: Number(l.replacement_fee || 0),
  }));

  return { po, lines };
}

export async function createFulfillPo(data: {
  po_number: string;
  store_id: string;
  supplier_id: string;
  order_date: string;
  target_date?: string | null;
  notes?: string | null;
  created_by?: string | null;
  lines: Array<{
    sku: string;
    product_type?: string | null;
    quantity: number;
    line_ship?: string | null;
    dimensions?: string | null;
    basecost?: number;
    fee_card?: number;
    fee_tag?: number;
    fee_stand?: number;
    fee_box?: number;
    design_url?: string | null;
    card_url?: string | null;
    tag_url?: string | null;
    box_url?: string | null;
    fnsku?: string | null;
    transparency_code?: string | null;
    shipment_id?: string | null;
  }>;
}): Promise<string> {
  const sql = await getDatabaseClient();

  return await sql.begin(async (trx: any) => {
    // 1. Calculate totals
    let totalQty = 0;
    let totalAmt = 0;

    const preparedLines = data.lines.map((line, idx) => {
      const qty = Math.max(0, line.quantity || 0);
      const base = Number(line.basecost || 0);
      const card = Number(line.fee_card || 0);
      const tag = Number(line.fee_tag || 0);
      const stand = Number(line.fee_stand || 0);
      const box = Number(line.fee_box || 0);
      const unitTotal = base + card + tag + stand + box;
      const lineTotal = Math.round(qty * unitTotal * 100) / 100;

      totalQty += qty;
      totalAmt += lineTotal;

      return {
        ...line,
        row_order: idx + 1,
        quantity: qty,
        basecost: base,
        fee_card: card,
        fee_tag: tag,
        fee_stand: stand,
        fee_box: box,
        total_line_cost: lineTotal,
      };
    });

    // 2. Insert PO
    const poRows = await trx`
      INSERT INTO fulfill_pos (
        po_number, store_id, supplier_id, order_date, target_date,
        status, total_quantity, total_amount, notes, created_by
      ) VALUES (
        ${data.po_number.trim().toUpperCase()},
        ${data.store_id},
        ${data.supplier_id},
        ${data.order_date},
        ${data.target_date || null},
        'draft',
        ${totalQty},
        ${totalAmt},
        ${data.notes || null},
        ${data.created_by || null}
      )
      RETURNING id
    `;

    const poId = poRows[0].id;

    // 3. Insert Lines
    for (const line of preparedLines) {
      await trx`
        INSERT INTO fulfill_po_lines (
          po_id, row_order, product_type, sku, quantity, line_ship, dimensions,
          basecost, fee_card, fee_tag, fee_stand, fee_box, total_line_cost,
          design_url, card_url, tag_url, box_url, fnsku, transparency_code,
          shipment_id
        ) VALUES (
          ${poId}, ${line.row_order}, ${line.product_type || null}, ${line.sku.trim().toUpperCase()},
          ${line.quantity}, ${line.line_ship || null}, ${line.dimensions || null},
          ${line.basecost}, ${line.fee_card}, ${line.fee_tag}, ${line.fee_stand},
          ${line.fee_box}, ${line.total_line_cost}, ${line.design_url || null},
          ${line.card_url || null}, ${line.tag_url || null}, ${line.box_url || null},
          ${line.fnsku || null}, ${line.transparency_code || null}, ${line.shipment_id || null}
        )
      `;
    }

    return poId;
  });
}

export async function patchFulfillPo(
  poId: string,
  updates: Partial<{
    status: string;
    notes: string;
    target_date: string | null;
  }>
): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE fulfill_pos
    SET
      status = COALESCE(${updates.status || null}, status),
      notes = COALESCE(${updates.notes ?? null}, notes),
      target_date = CASE WHEN ${updates.target_date !== undefined} THEN ${updates.target_date || null}::date ELSE target_date END,
      updated_at = NOW()
    WHERE id = ${poId}
  `;
}

export async function patchFulfillPoLine(
  lineId: string,
  field: string,
  value: any
): Promise<void> {
  const sql = await getDatabaseClient();

  // Validate allowed fields
  const allowedFields = new Set([
    "product_type", "sku", "quantity", "line_ship", "dimensions",
    "basecost", "fee_card", "fee_tag", "fee_stand", "fee_box",
    "design_url", "card_url", "tag_url", "box_url", "transparency_code",
    "fnsku", "label_fnsku", "shipment_id", "box_quantity", "shipping_label",
    "shipping_address", "shipping_out_date", "arrival_date", "replacement_fee",
    "sample_url", "package_url", "check_status", "notes"
  ]);

  if (!allowedFields.has(field)) {
    throw new Error(`Trường "${field}" không được phép cập nhật.`);
  }

  // Update the field
  await sql`
    UPDATE fulfill_po_lines
    SET
      ${sql(field)} = ${value === "" ? null : value},
      updated_at = NOW()
    WHERE id = ${lineId}
  `;

  // Re-calculate line total if costs or quantity changed
  if (["quantity", "basecost", "fee_card", "fee_tag", "fee_stand", "fee_box"].includes(field)) {
    await sql`
      UPDATE fulfill_po_lines
      SET total_line_cost = ROUND((quantity * (basecost + fee_card + fee_tag + fee_stand + fee_box))::numeric, 2)
      WHERE id = ${lineId}
    `;

    // Re-calculate PO total
    await sql`
      WITH line_sum AS (
        SELECT po_id, SUM(quantity)::int as sum_qty, SUM(total_line_cost)::numeric as sum_amt
        FROM fulfill_po_lines
        WHERE po_id = (SELECT po_id FROM fulfill_po_lines WHERE id = ${lineId})
        GROUP BY po_id
      )
      UPDATE fulfill_pos
      SET
        total_quantity = line_sum.sum_qty,
        total_amount = line_sum.sum_amt,
        updated_at = NOW()
      FROM line_sum
      WHERE fulfill_pos.id = line_sum.po_id
    `;
  }
}

export async function addFulfillPoLine(poId: string, data: Partial<FulfillPoLine>): Promise<FulfillPoLine> {
  const sql = await getDatabaseClient();

  const maxOrderRows = await sql<{ max_order: number }[]>`
    SELECT COALESCE(MAX(row_order), 0)::int as max_order FROM fulfill_po_lines WHERE po_id = ${poId}
  `;
  const nextOrder = (maxOrderRows[0]?.max_order || 0) + 1;

  const qty = Math.max(0, data.quantity || 0);
  const base = Number(data.basecost || 0);
  const card = Number(data.fee_card || 0);
  const tag = Number(data.fee_tag || 0);
  const stand = Number(data.fee_stand || 0);
  const box = Number(data.fee_box || 0);
  const total = Math.round(qty * (base + card + tag + stand + box) * 100) / 100;

  const rows = await sql<any[]>`
    INSERT INTO fulfill_po_lines (
      po_id, row_order, product_type, sku, quantity, line_ship, dimensions,
      basecost, fee_card, fee_tag, fee_stand, fee_box, total_line_cost,
      design_url, card_url, tag_url, box_url, fnsku, transparency_code,
      label_fnsku, shipment_id, box_quantity, shipping_label, shipping_address
    ) VALUES (
      ${poId}, ${nextOrder}, ${data.product_type || null}, ${String(data.sku || "").trim().toUpperCase()},
      ${qty}, ${data.line_ship || null}, ${data.dimensions || null},
      ${base}, ${card}, ${tag}, ${stand}, ${box}, ${total},
      ${data.design_url || null}, ${data.card_url || null}, ${data.tag_url || null}, ${data.box_url || null},
      ${data.fnsku || null}, ${data.transparency_code || null}, ${data.label_fnsku || null},
      ${data.shipment_id || null}, ${data.box_quantity || null}, ${data.shipping_label || null},
      ${data.shipping_address || null}
    )
    RETURNING
      id, po_id, row_order, product_type, sku, quantity, line_ship, dimensions,
      basecost::float, fee_card::float, fee_tag::float, fee_stand::float, fee_box::float,
      total_line_cost::float, design_url, card_url, tag_url, box_url, transparency_code,
      fnsku, label_fnsku, shipment_id, box_quantity, shipping_label, shipping_address,
      shipping_out_date::text, arrival_date::text, replacement_fee::float, sample_url,
      package_url, check_status, notes, created_at::text, updated_at::text
  `;

  // Re-calculate PO totals
  await sql`
    WITH line_sum AS (
      SELECT po_id, SUM(quantity)::int as sum_qty, SUM(total_line_cost)::numeric as sum_amt
      FROM fulfill_po_lines
      WHERE po_id = ${poId}
      GROUP BY po_id
    )
    UPDATE fulfill_pos
    SET
      total_quantity = line_sum.sum_qty,
      total_amount = line_sum.sum_amt,
      updated_at = NOW()
    FROM line_sum
    WHERE fulfill_pos.id = line_sum.po_id
  `;

  return rows[0];
}

export async function deleteFulfillPoLine(lineId: string): Promise<void> {
  const sql = await getDatabaseClient();

  const lineRows = await sql<{ po_id: string }[]>`
    DELETE FROM fulfill_po_lines WHERE id = ${lineId} RETURNING po_id
  `;

  if (lineRows.length) {
    const poId = lineRows[0].po_id;
    await sql`
      WITH line_sum AS (
        SELECT po_id, COALESCE(SUM(quantity), 0)::int as sum_qty, COALESCE(SUM(total_line_cost), 0)::numeric as sum_amt
        FROM fulfill_po_lines
        WHERE po_id = ${poId}
        GROUP BY po_id
      )
      UPDATE fulfill_pos
      SET
        total_quantity = COALESCE(line_sum.sum_qty, 0),
        total_amount = COALESCE(line_sum.sum_amt, 0),
        updated_at = NOW()
      FROM line_sum
      WHERE fulfill_pos.id = ${poId}
    `;
  }
}

export async function deleteFulfillPo(poId: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`DELETE FROM fulfill_pos WHERE id = ${poId}`;
}

// ==========================================
// 3. SKU MASTER (FULFILL)
// ==========================================

export async function listFulfillSkuMaster(filters: {
  storeId?: string;
  search?: string;
}): Promise<FulfillSkuMasterItem[]> {
  const sql = await getDatabaseClient();
  const searchPattern = filters.search ? `%${filters.search.trim().toLowerCase()}%` : null;

  const rows = await sql<any[]>`
    SELECT
      fsm.id,
      fsm.store_id,
      st.name as store_name,
      fsm.sku,
      fsm.asin,
      fsm.fnsku,
      fsm.transparency_code,
      fsm.product_name,
      fsm.dimensions,
      fsm.pcs_per_box,
      fsm.design_url,
      fsm.card_url,
      fsm.tag_url,
      fsm.box_url,
      fsm.basecost::float,
      fsm.fee_card::float,
      fsm.fee_tag::float,
      fsm.fee_stand::float,
      fsm.fee_box::float,
      fsm.notes,
      fsm.created_at::text,
      fsm.updated_at::text
    FROM fulfill_sku_master fsm
    LEFT JOIN stores st ON st.id = fsm.store_id
    WHERE (${filters.storeId || null}::uuid IS NULL OR fsm.store_id = ${filters.storeId || null}::uuid)
      AND (${searchPattern}::text IS NULL OR (
        LOWER(fsm.sku) LIKE ${searchPattern}
        OR LOWER(COALESCE(fsm.asin, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(fsm.product_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(st.name, '')) LIKE ${searchPattern}
      ))
    ORDER BY fsm.sku ASC
  `;

  return rows.map((r) => ({
    ...r,
    pcs_per_box: Number(r.pcs_per_box || 1),
    basecost: Number(r.basecost || 0),
    fee_card: Number(r.fee_card || 0),
    fee_tag: Number(r.fee_tag || 0),
    fee_stand: Number(r.fee_stand || 0),
    fee_box: Number(r.fee_box || 0),
  }));
}

export async function upsertFulfillSkuMasterItem(data: {
  store_id: string;
  sku: string;
  asin?: string | null;
  fnsku?: string | null;
  transparency_code?: string | null;
  product_name?: string | null;
  dimensions?: string | null;
  pcs_per_box?: number;
  design_url?: string | null;
  card_url?: string | null;
  tag_url?: string | null;
  box_url?: string | null;
  basecost?: number;
  fee_card?: number;
  fee_tag?: number;
  fee_stand?: number;
  fee_box?: number;
  notes?: string | null;
}): Promise<FulfillSkuMasterItem> {
  const sql = await getDatabaseClient();
  const sku = data.sku.trim().toUpperCase();

  const rows = await sql<any[]>`
    INSERT INTO fulfill_sku_master (
      store_id, sku, asin, fnsku, transparency_code, product_name, dimensions,
      pcs_per_box, design_url, card_url, tag_url, box_url,
      basecost, fee_card, fee_tag, fee_stand, fee_box, notes
    ) VALUES (
      ${data.store_id}, ${sku}, ${data.asin || null}, ${data.fnsku || null},
      ${data.transparency_code || null}, ${data.product_name || null}, ${data.dimensions || null},
      ${data.pcs_per_box || 1}, ${data.design_url || null}, ${data.card_url || null},
      ${data.tag_url || null}, ${data.box_url || null}, ${data.basecost || 0},
      ${data.fee_card || 0}, ${data.fee_tag || 0}, ${data.fee_stand || 0},
      ${data.fee_box || 0}, ${data.notes || null}
    )
    ON CONFLICT (store_id, sku) DO UPDATE SET
      asin = COALESCE(EXCLUDED.asin, fulfill_sku_master.asin),
      fnsku = COALESCE(EXCLUDED.fnsku, fulfill_sku_master.fnsku),
      transparency_code = COALESCE(EXCLUDED.transparency_code, fulfill_sku_master.transparency_code),
      product_name = COALESCE(EXCLUDED.product_name, fulfill_sku_master.product_name),
      dimensions = COALESCE(EXCLUDED.dimensions, fulfill_sku_master.dimensions),
      pcs_per_box = COALESCE(EXCLUDED.pcs_per_box, fulfill_sku_master.pcs_per_box),
      design_url = COALESCE(EXCLUDED.design_url, fulfill_sku_master.design_url),
      card_url = COALESCE(EXCLUDED.card_url, fulfill_sku_master.card_url),
      tag_url = COALESCE(EXCLUDED.tag_url, fulfill_sku_master.tag_url),
      box_url = COALESCE(EXCLUDED.box_url, fulfill_sku_master.box_url),
      basecost = COALESCE(EXCLUDED.basecost, fulfill_sku_master.basecost),
      fee_card = COALESCE(EXCLUDED.fee_card, fulfill_sku_master.fee_card),
      fee_tag = COALESCE(EXCLUDED.fee_tag, fulfill_sku_master.fee_tag),
      fee_stand = COALESCE(EXCLUDED.fee_stand, fulfill_sku_master.fee_stand),
      fee_box = COALESCE(EXCLUDED.fee_box, fulfill_sku_master.fee_box),
      notes = COALESCE(EXCLUDED.notes, fulfill_sku_master.notes),
      updated_at = NOW()
    RETURNING
      id, store_id, sku, asin, fnsku, transparency_code, product_name, dimensions,
      pcs_per_box, design_url, card_url, tag_url, box_url, basecost::float,
      fee_card::float, fee_tag::float, fee_stand::float, fee_box::float, notes,
      created_at::text, updated_at::text
  `;

  return rows[0];
}

/** Tự động đồng bộ các SKU từ accounting_sku_master sang fulfill_sku_master */
export async function syncFromAccountingSkuMaster(storeId?: string): Promise<{ synced: number }> {
  const sql = await getDatabaseClient();

  const result = await sql`
    INSERT INTO fulfill_sku_master (
      store_id, sku, asin, fnsku, product_name, dimensions, design_url,
      basecost, created_at, updated_at
    )
    SELECT
      asm.store_id,
      asm.sku,
      asm.asin,
      asm.fnsku,
      asm.product_type,
      asm.kich_thuoc,
      asm.file_design,
      COALESCE(asm.basecost_tb, 0),
      NOW(),
      NOW()
    FROM accounting_sku_master asm
    WHERE asm.deleted_at IS NULL
      AND (${storeId || null}::uuid IS NULL OR asm.store_id = ${storeId || null}::uuid)
    ON CONFLICT (store_id, sku) DO UPDATE SET
      asin = COALESCE(fulfill_sku_master.asin, EXCLUDED.asin),
      fnsku = COALESCE(fulfill_sku_master.fnsku, EXCLUDED.fnsku),
      product_name = COALESCE(fulfill_sku_master.product_name, EXCLUDED.product_name),
      dimensions = COALESCE(fulfill_sku_master.dimensions, EXCLUDED.dimensions),
      design_url = COALESCE(fulfill_sku_master.design_url, EXCLUDED.design_url),
      basecost = CASE WHEN fulfill_sku_master.basecost = 0 THEN EXCLUDED.basecost ELSE fulfill_sku_master.basecost END,
      updated_at = NOW()
  `;

  return { synced: result.count || 0 };
}
