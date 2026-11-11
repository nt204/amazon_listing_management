import "server-only";

// Tool đọc dữ liệu cho bot Lark: KPI so với kế hoạch, tồn kho / sắp hết hàng, lãi theo SKU, tiến độ Trello & mockup.
// Quyền store do executeTool() kiểm tra trước khi gọi (storeQuery đã được thay bằng đúng tên store được cấp).
// Tool Trello / mockup không theo store: chỉ trả batch / job do chính người hỏi tạo.

import { getDatabaseClient } from "@/lib/db";
import { listStores, getLatestAvailableAccountingDate } from "./accounting-db";
import { getKpi } from "./kpi-db";
import { periodLabel } from "./kpi-calc";
import { listSkuWin } from "./sku-win-db";
import { PPC_TO_ACCOUNTING_STORE_NAME_MAP } from "@/lib/ppc/sku-architecture-service";
import {
  classifyStock,
  mondayOf,
  monthPace,
  shiftDate,
  skuTarget,
  summarizeKpi,
  vnDate,
  vnToday,
  type StockInput,
  type StockThresholds,
} from "./lark-insights-calc";

const money = (v: number | null | undefined) => (v == null ? null : Math.round(v));
const pct1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);

/** Tên store PPC (bảng Phân quyền Store) → tên store kế toán (vd HSOSTORE → WARMSTOREY). */
export function toAccountingStoreName(name: string): string {
  const upper = name.trim().toUpperCase();
  return PPC_TO_ACCOUNTING_STORE_NAME_MAP[upper] || name.trim();
}

/** Store kế toán theo tên chính xác (không khớp gần đúng để không lấy nhầm store khác). */
export async function resolveAccountingStoreExact(storeQuery?: string) {
  const q = toAccountingStoreName(String(storeQuery || "")).toLowerCase();
  if (!q) return null;
  const stores = await listStores();
  return stores.find((s) => s.id === storeQuery || s.name.trim().toLowerCase() === q) ?? null;
}

function needStore(storeQuery?: string) {
  return { hasData: false, error: storeQuery ? `Không tìm thấy store "${storeQuery}" trong dữ liệu kế toán.` : "Cần nêu tên store." };
}

// ───────────── 5. KPI so với kế hoạch ─────────────

const KPI_ROWS = [
  ["revenue", "Revenue"],
  ["quantity", "Units"],
  ["ads_fee", "Ads Spend"],
  ["tacos", "TACoS"],
  ["gross", "Gross Profit"],
] as const;

export async function getKpiProgress(params: { storeQuery?: string; period?: string }) {
  const store = await resolveAccountingStoreExact(params.storeQuery);
  if (!store) return needStore(params.storeQuery);

  const latest = await getLatestAvailableAccountingDate();
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period || "") ? params.period! : latest.slice(0, 7);
  const data = await getKpi(store.id, period);
  const { report, hasTargetCur } = summarizeKpi(data);
  const pace = monthPace(period, latest);
  const running = pace.pace > 0 && pace.pace < 1;

  const isMoney = (key: string) => key !== "quantity" && key !== "tacos";
  const rows = KPI_ROWS.map(([key, label]) => {
    const r = report[key];
    const actual = r.cur ?? null;
    const target = r.tCur ?? null;
    const ratio = r.kpi ?? null;
    const round = (v: number | null) => (v == null ? null : key === "tacos" ? pct1(v) : isMoney(key) ? money(v) : Math.round(v));
    return {
      chi_so: label,
      don_vi: key === "tacos" ? "%" : key === "quantity" ? "units" : "$",
      thuc_te: round(actual),
      muc_tieu_thang: round(target),
      ty_le_dat_pct: pct1(ratio),
      // Tháng đang chạy: mục tiêu tới ngày có dữ liệu (tỉ lệ theo số ngày) và dự kiến cả tháng theo nhịp hiện tại
      muc_tieu_toi_nay: running && target != null && key !== "tacos" ? round(target * pace.pace) : undefined,
      du_kien_ca_thang: running && actual != null && key !== "tacos" ? round(actual / pace.pace) : undefined,
      thang_truoc: round(r.prev ?? null),
      cung_ky_nam_truoc: round(r.ly ?? null),
    };
  });

  // SKU phát triển chậm / vượt mục tiêu nhiều nhất (theo Revenue, so với nhịp tháng)
  const skuRows = data.skus
    .filter((s) => s.group === "dev")
    .map((s) => {
      const t = skuTarget(s, "cur", data.targetFormula);
      if (!t || !t.revenue) return null;
      const actual = s.actual.cur?.revenue ?? 0;
      const expected = t.revenue * (pace.pace || 1);
      return {
        sku: s.sku,
        revenue: money(actual),
        muc_tieu_revenue_thang: money(t.revenue),
        ty_le_dat_pct: pct1(actual / t.revenue),
        chenh_so_voi_nhip: money(actual - expected),
        profit: money(s.actual.cur?.profit ?? null),
        muc_tieu_profit_thang: money(t.profit),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const behind = [...skuRows].sort((a, b) => a.chenh_so_voi_nhip! - b.chenh_so_voi_nhip!).filter((x) => x.chenh_so_voi_nhip! < 0).slice(0, 5);
  const ahead = [...skuRows].sort((a, b) => b.chenh_so_voi_nhip! - a.chenh_so_voi_nhip!).filter((x) => x.chenh_so_voi_nhip! > 0).slice(0, 3);

  const notes: string[] = [];
  if (!hasTargetCur) notes.push(`Tháng ${periodLabel(period)} chưa có mục tiêu (KPI) cho SKU phát triển của ${store.name}, chưa tính được % đạt.`);
  if (running) {
    notes.push(
      `Tháng đang chạy: dữ liệu tới ${vnDate(latest)} (${pace.elapsedDays}/${pace.daysInMonth} ngày, nhịp ${pct1(pace.pace)}% tháng). ` +
        `"ty_le_dat_pct" là so với mục tiêu CẢ THÁNG; so với nhịp thì dùng "muc_tieu_toi_nay".`,
    );
  } else if (pace.pace === 0) {
    notes.push(`Tháng ${periodLabel(period)} chưa có dữ liệu thực tế (dữ liệu mới nhất ${vnDate(latest)}).`);
  }
  if (data.sources.cur === "live") notes.push("Thực tế tháng này là số tạm tính (chưa chốt SKU Monthly).");

  return {
    hasData: true,
    store: store.name,
    thang: periodLabel(period),
    pham_vi: "SKU phát triển (tổng team) như bảng BÁO CÁO THÁNG trên trang KPI kinh doanh; SKU test tính riêng ở P/L SKU testing.",
    du_lieu_toi_ngay: latest,
    ghi_chu: notes,
    tong_team: rows,
    pl_sku_testing: money(report.pl_test.cur ?? null),
    sku_cham_kpi: behind,
    sku_vuot_kpi: ahead,
    instructions:
      "Trình bày: dòng đầu nêu tháng, store, dữ liệu tới ngày nào. Mỗi chỉ số 1 dòng: Thực tế / Mục tiêu tháng (đạt X%). " +
      "Tháng đang chạy thì nêu thêm mục tiêu tới nay và dự kiến cả tháng. TACoS: thấp hơn mục tiêu là tốt. " +
      "Sau đó liệt kê tối đa 5 SKU chậm KPI (số âm = thiếu so với nhịp). Chỉ dùng số trong kết quả, không tự tính lại.",
  };
}

// ───────────── 6. Tồn kho & sắp hết hàng ─────────────

const envNum = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export function stockThresholds(over: Partial<StockThresholds> = {}): StockThresholds {
  const clamp = (v: number | undefined, d: number, min: number, max: number) =>
    v != null && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
  return {
    velocityDays: clamp(over.velocityDays, envNum("LARK_STOCK_VELOCITY_DAYS", 14), 7, 60),
    lowDays: clamp(over.lowDays, envNum("LARK_STOCK_LOW_DAYS", 14), 1, 90),
    reorderDays: clamp(over.reorderDays, envNum("LARK_STOCK_REORDER_DAYS", 45), 7, 180),
  };
}

const LEVEL_LABEL = {
  het_hang: "Hết hàng (đang có đơn)",
  sap_het: "Sắp hết",
  can_nhap: "Cần nhập thêm",
  du_hang: "Đủ hàng",
  khong_ban: "Không bán",
  chua_co_ton: "Chưa có số tồn (không có trong Inventory Ledger)",
} as const;

/** Tồn FBA từng SKU (Inventory Ledger mới nhất) + hàng đang về + tốc độ bán FBA. */
export async function loadStockRows(storeId: string, th: StockThresholds) {
  const sql = await getDatabaseClient();
  const [latestRow] = await sql<Array<{ d: string | null }>>`
    SELECT MAX(date)::text AS d FROM accounting_orders
    WHERE store_id = ${storeId} AND fulfillment_channel = 'Amazon'
  `;
  const salesEnd = latestRow?.d || null;
  const salesStart = salesEnd ? shiftDate(salesEnd, -(th.velocityDays - 1)) : null;

  const [balance, inbound, sales, master] = await Promise.all([
    sql<Array<{ sku: string; sellable: number; unsellable: number; in_transit: number; snapshot: string | null }>>`
      SELECT UPPER(TRIM(sku)) AS sku,
        SUM(sellable_balance)::float AS sellable,
        SUM(unsellable_balance)::float AS unsellable,
        SUM(in_transit_between_warehouses)::float AS in_transit,
        MAX(snapshot_date)::text AS snapshot
      FROM accounting_inventory_balance
      WHERE store_id = ${storeId}
      GROUP BY 1
    `,
    // Lô chưa đóng / chưa hủy: phần Amazon chưa nhận
    sql<Array<{ sku: string; pending: number; next_arrival: string | null }>>`
      SELECT UPPER(TRIM(sku)) AS sku,
        SUM(GREATEST(COALESCE(quantity, 0) - COALESCE(amazon_received, 0), 0))::float AS pending,
        -- ngay_den là text YYYY-MM-DD: chỉ lấy ngày về từ hôm nay trở đi
        MIN(LEFT(ngay_den, 10)) FILTER (
          WHERE ngay_den ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND LEFT(ngay_den, 10) >= ${vnToday()}
        ) AS next_arrival
      FROM accounting_inbound_shipments
      WHERE store_id = ${storeId} AND deleted_at IS NULL
        AND LOWER(COALESCE(status, '')) NOT IN ('closed', 'cancelled', 'canceled', 'deleted')
        AND LOWER(COALESCE(trang_thai, '')) NOT IN ('hủy', 'huỷ', 'huy')
        AND COALESCE(TRIM(sku), '') <> ''
      GROUP BY 1
    `,
    salesEnd
      ? sql<Array<{ sku: string; units: number }>>`
          SELECT UPPER(TRIM(sku)) AS sku, SUM(COALESCE(quantity, 1))::float AS units
          FROM accounting_orders
          WHERE store_id = ${storeId}
            AND date BETWEEN ${salesStart}::date AND ${salesEnd}::date
            AND fulfillment_channel = 'Amazon'
            AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
            AND COALESCE(TRIM(sku), '') <> ''
          GROUP BY 1
        `
      : Promise.resolve([] as Array<{ sku: string; units: number }>),
    sql<Array<{ sku: string; status: string | null }>>`
      SELECT DISTINCT ON (UPPER(TRIM(sku))) UPPER(TRIM(sku)) AS sku, status
      FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND UPPER(COALESCE(loai, 'FBA')) = 'FBA'
      ORDER BY UPPER(TRIM(sku)), updated_at DESC
    `,
  ]);

  const rows = new Map<string, StockInput>();
  const get = (sku: string) => {
    let r = rows.get(sku);
    if (!r) rows.set(sku, (r = { sku, status: null, sellable: 0, unsellable: 0, inTransit: 0, inboundPending: 0, nextArrival: null, unitsSold: 0 }));
    return r;
  };
  let snapshot: string | null = null;
  for (const b of balance) {
    const r = get(b.sku);
    r.sellable = Number(b.sellable) || 0;
    r.unsellable = Number(b.unsellable) || 0;
    r.inTransit = Number(b.in_transit) || 0;
    if (b.snapshot && (!snapshot || b.snapshot > snapshot)) snapshot = b.snapshot;
  }
  for (const i of inbound) {
    const r = get(i.sku);
    r.inboundPending = Number(i.pending) || 0;
    r.nextArrival = i.next_arrival;
  }
  for (const s of sales) get(s.sku).unitsSold = Number(s.units) || 0;
  const statusBySku = new Map(master.map((m) => [m.sku, m.status]));
  const balanceSkus = new Set(balance.map((b) => b.sku));
  for (const r of rows.values()) {
    r.status = statusBySku.get(r.sku) ?? null;
    r.hasBalance = balanceSkus.has(r.sku);
  }

  // SKU đã OFF / Hủy trong Bảng mã: không cảnh báo, không gợi ý nhập
  const stopped = (status: string | null) => /^(off|hủy|huỷ|huy)$/i.test(String(status ?? "").trim());
  const all = [...rows.values()];
  const items = all.filter((r) => !stopped(r.status)).map((r) => ({ ...r, ...classifyStock(r, th) }));
  return { items, snapshot, salesStart, salesEnd, stoppedCount: all.length - items.length };
}

export async function getInventoryStatus(params: {
  storeQuery?: string;
  sku?: string;
  filter?: "attention" | "all";
  lowDays?: number;
  reorderDays?: number;
  limit?: number;
}) {
  const store = await resolveAccountingStoreExact(params.storeQuery);
  if (!store) return needStore(params.storeQuery);
  const th = stockThresholds({ lowDays: params.lowDays, reorderDays: params.reorderDays });
  const [{ items, snapshot, salesStart, salesEnd, stoppedCount }, latest] = await Promise.all([
    loadStockRows(store.id, th),
    getLatestAvailableAccountingDate(),
  ]);
  if (!snapshot) {
    return {
      hasData: false,
      store: store.name,
      message: `Chưa có dữ liệu tồn kho (Inventory Ledger) của ${store.name} nên chưa tính được SKU sắp hết hàng. Cần nạp file Inventory Ledger trên trang Tồn kho.`,
    };
  }

  const notes: string[] = [];
  if (salesEnd && salesEnd < shiftDate(latest, -2)) {
    notes.push(`Đơn FBA của ${store.name} mới có tới ${vnDate(salesEnd)} (dữ liệu chung tới ${vnDate(latest)}): tốc độ bán tính tới ngày đó.`);
  }
  if (stoppedCount) notes.push(`Đã bỏ qua ${stoppedCount} SKU trạng thái OFF / Hủy trong Bảng mã.`);
  if (snapshot && salesEnd && snapshot < shiftDate(salesEnd, -3)) {
    notes.push(`Tồn kho chốt ngày ${vnDate(snapshot)}, cũ hơn dữ liệu đơn (${vnDate(salesEnd)}) quá 3 ngày: số tồn thực tế có thể đã thấp hơn.`);
  }
  const shape = (x: (typeof items)[number]) => ({
    sku: x.sku,
    muc: LEVEL_LABEL[x.level],
    trang_thai_sku: x.status,
    ton_san_ban: x.sellable,
    ton_loi: x.unsellable || undefined,
    dang_chuyen_kho: x.inTransit || undefined,
    hang_dang_ve: x.inboundPending || undefined,
    ngay_ve_gan_nhat: x.nextArrival || undefined,
    ban_moi_ngay: x.unitsPerDay,
    so_ngay_con_ban: x.daysOfCover,
    so_ngay_tinh_ca_hang_ve: x.daysWithInbound,
    goi_y_nhap_them: x.suggestUnits || undefined,
  });

  const window = { tu: salesStart, den: salesEnd, so_ngay: th.velocityDays };
  if (params.sku?.trim()) {
    const wanted = params.sku.trim().toUpperCase();
    const hit = items.filter((x) => x.sku === wanted || x.sku.includes(wanted));
    return {
      hasData: hit.length > 0,
      store: store.name,
      ton_kho_chot_ngay: snapshot,
      toc_do_ban_tinh_tu: window,
      message: hit.length ? undefined : `Không thấy SKU "${params.sku}" trong tồn kho / đơn FBA của ${store.name}.`,
      skus: hit.slice(0, 10).map(shape),
      ghi_chu: notes,
    };
  }

  const order = { het_hang: 0, sap_het: 1, can_nhap: 2, du_hang: 3, khong_ban: 4, chua_co_ton: 5 } as const;
  const attention = items
    .filter((x) => x.level === "het_hang" || x.level === "sap_het" || x.level === "can_nhap")
    .sort((a, b) => order[a.level] - order[b.level] || b.unitsPerDay - a.unitsPerDay);
  const limit = Math.min(30, Math.max(1, params.limit || 15));
  const list = params.filter === "all" ? [...items].sort((a, b) => b.unitsPerDay - a.unitsPerDay) : attention;
  const count = (lv: keyof typeof order) => items.filter((x) => x.level === lv).length;

  return {
    hasData: true,
    store: store.name,
    ton_kho_chot_ngay: snapshot,
    toc_do_ban_tinh_tu: window,
    nguong: {
      sap_het: `còn bán < ${th.lowDays} ngày (chỉ tính hàng sẵn bán)`,
      can_nhap: `tính cả hàng đang chuyển kho + lô đang về vẫn < ${th.reorderDays} ngày`,
      goi_y_nhap_them: `đủ bán ${th.reorderDays} ngày theo tốc độ bán hiện tại`,
    },
    tong_quan: {
      het_hang: count("het_hang"),
      sap_het: count("sap_het"),
      can_nhap: count("can_nhap"),
      du_hang: count("du_hang"),
      tong_sku_dang_ban: items.filter((x) => x.level !== "khong_ban" && x.level !== "chua_co_ton").length,
      sku_co_ban_nhung_chua_co_so_ton: count("chua_co_ton") || undefined,
    },
    skus: list.slice(0, limit).map(shape),
    con_lai: Math.max(0, list.length - limit),
    ghi_chu: notes,
    instructions:
      "Nêu ngày chốt tồn và khoảng ngày tính tốc độ bán. Liệt kê đánh số theo mức: Hết hàng → Sắp hết → Cần nhập thêm. " +
      "Mỗi SKU 1-2 dòng: tồn sẵn bán, bán/ngày, còn bán bao nhiêu ngày, hàng đang về (ngày về), gợi ý nhập thêm. " +
      "Gợi ý nhập chỉ là ước tính theo tốc độ bán, ghi rõ như vậy. Không tự tính lại số.",
  };
}

// ───────────── 7. Lãi theo SKU (Base Cost) ─────────────

export async function getSkuProfit(params: {
  storeQuery?: string;
  startDate?: string;
  endDate?: string;
  sort?: "loss" | "profit";
  sku?: string;
  limit?: number;
}) {
  const store = await resolveAccountingStoreExact(params.storeQuery);
  if (!store) return needStore(params.storeQuery);

  const latest = await getLatestAvailableAccountingDate();
  const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  let endDate = isDate(params.endDate) ? params.endDate! : latest;
  const clamped = endDate > latest;
  if (clamped) endDate = latest;
  // Mặc định "tuần này": từ Thứ Hai của tuần chứa ngày có dữ liệu mới nhất
  let startDate = isDate(params.startDate) ? params.startDate! : mondayOf(endDate);
  if (startDate > endDate) startDate = endDate;

  const { items, stats } = await listSkuWin(store.id, {
    status: "all",
    startDate,
    endDate,
    limit: 100_000,
    includeAllTime: false,
    search: params.sku?.trim() || undefined,
  });
  const active = items.filter((it) => it.revenue || it.quantity || it.ads_fee || it.profit);
  const shape = (it: (typeof items)[number]) => ({
    sku: it.sku,
    trang_thai: it.status,
    product_type: it.product_type,
    revenue: money(it.revenue),
    units: it.quantity,
    basecost: money(it.basecost),
    basecost_moi_unit: it.quantity ? Math.round((it.basecost / it.quantity) * 100) / 100 : null,
    amazon_fee: money(it.amazon_fee),
    ads_spend: money(it.ads_fee),
    thue: money(it.thue),
    return_cost: money(it.return_cost),
    profit: Math.round(it.profit * 100) / 100,
    margin_pct: it.revenue ? pct1(it.profit / it.revenue) : null,
    tacos_pct: it.revenue ? pct1(it.ads_fee / it.revenue) : null,
  });

  const limit = Math.min(20, Math.max(1, params.limit || 10));
  const sorted = params.sort === "profit"
    ? [...active].sort((a, b) => b.profit - a.profit)
    : [...active].filter((it) => it.profit < 0).sort((a, b) => a.profit - b.profit);
  const notes: string[] = [];
  if (clamped || (params.endDate && params.endDate > latest)) notes.push(`Dữ liệu kế toán mới nhất tới ${vnDate(latest)}; các ngày sau chưa có.`);
  const missingBase = active.filter((it) => it.quantity > 0 && !it.basecost).map((it) => it.sku);
  if (missingBase.length) notes.push(`${missingBase.length} SKU có bán nhưng Basecost = 0 (chưa có giá vốn): ${missingBase.slice(0, 5).join(", ")}${missingBase.length > 5 ? "…" : ""}. Profit các SKU này đang cao hơn thực tế.`);

  return {
    hasData: active.length > 0,
    store: store.name,
    khoang_ngay: { tu: startDate, den: endDate },
    cong_thuc: "Profit = Revenue − Ads − Basecost − Amazon Fee − Thuế − Return (như Lọc SKU Win / KQKD SKU).",
    tong_store: {
      revenue: money(stats.totalRevenue),
      profit: money(stats.totalProfit),
      basecost: money(stats.totalBasecost),
      so_sku_lai: active.filter((it) => it.profit > 0).length,
      so_sku_lo: active.filter((it) => it.profit < 0).length,
      tong_lo_cua_sku_lo: money(active.filter((it) => it.profit < 0).reduce((s, it) => s + it.profit, 0)),
    },
    skus: (params.sku?.trim() ? active : sorted).slice(0, limit).map(shape),
    message: active.length ? undefined : `Không có SKU nào phát sinh số liệu ${vnDate(startDate)} – ${vnDate(endDate)} ở ${store.name}.`,
    ghi_chu: notes,
    instructions:
      "Dòng đầu nêu store và khoảng ngày (DD/MM – DD/MM). Danh sách đánh số, mỗi SKU: Profit, Revenue, Units, Basecost/unit, Ads, Margin. " +
      "Có ghi_chu về Basecost = 0 thì nêu trước. Không dùng bảng ngang, không tự tính lại số.",
  };
}

// ───────────── 8. Trello listing batch & mockup ─────────────

export async function getListingJobsStatus(actor: { teamId: string; actorId: string } | null, params: { date?: string }) {
  if (!actor) {
    return { hasData: false, error: "Cần tài khoản Lark đã liên kết NCE HUB để xem batch Trello / mockup của bạn." };
  }
  const sql = await getDatabaseClient();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "") ? params.date! : vnToday();
  // Ngày theo giờ Việt Nam
  const from = `${day}T00:00:00+07:00`;
  const to = `${shiftDate(day, 1)}T00:00:00+07:00`;

  const [batches, mockups] = await Promise.all([
    sql<Array<{
      id: string; shop_name: string | null; brand_name: string | null; template_name: string | null; status: string;
      total_cards: number; completed_cards: number; failed_cards: number; created_at: string; completed_at: string | null; error_message: string | null;
    }>>`
      SELECT id, shop_name, brand_name, template_name, status, total_cards, completed_cards, failed_cards,
        created_at::text, completed_at::text, error_message
      FROM trello_listing_batches
      WHERE team_id = ${actor.teamId} AND actor_id = ${actor.actorId}
        AND (
          (created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz)
          OR status IN ('running', 'paused', 'queued')
        )
      ORDER BY created_at DESC
      LIMIT 20
    `,
    sql<Array<{ status: string; n: number; last_error: string | null }>>`
      SELECT status, COUNT(*)::int AS n,
        (ARRAY_AGG(error_message ORDER BY updated_at DESC) FILTER (WHERE error_message IS NOT NULL))[1] AS last_error
      FROM mockup_jobs
      WHERE team_id = ${actor.teamId} AND actor_id = ${actor.actorId}
        AND (
          (created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz)
          OR status IN ('queued', 'running', 'cancel_requested')
        )
      GROUP BY status
    `,
  ]);

  const failedIds = batches.filter((b) => b.failed_cards > 0).map((b) => b.id);
  const failedItems = failedIds.length
    ? await sql<Array<{ batch_id: string; card_name: string | null; sku: string | null; error_message: string | null }>>`
        SELECT batch_id, card_name, sku, error_message FROM trello_listing_batch_items
        WHERE batch_id = ANY(${failedIds}::uuid[]) AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 30
      `
    : [];

  const statusVi: Record<string, string> = {
    running: "Đang chạy", queued: "Đang chờ", paused: "Tạm dừng", completed: "Xong", failed: "Lỗi", cancelled: "Đã hủy",
  };
  const toVnTime = (ts: string | null) =>
    ts ? new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : null;

  return {
    hasData: batches.length > 0 || mockups.length > 0,
    ngay: day,
    pham_vi: "Chỉ batch Trello / job mockup do chính bạn tạo.",
    trello_batches: batches.map((b) => ({
      shop: b.shop_name || b.brand_name,
      template: b.template_name,
      trang_thai: statusVi[b.status] || b.status,
      xong: `${b.completed_cards}/${b.total_cards}`,
      loi: b.failed_cards,
      tao_luc: toVnTime(b.created_at),
      xong_luc: toVnTime(b.completed_at),
      loi_batch: b.error_message || undefined,
      card_loi: failedItems
        .filter((i) => i.batch_id === b.id)
        .slice(0, 5)
        .map((i) => ({ card: i.card_name || i.sku, loi: (i.error_message || "").slice(0, 160) })),
    })),
    mockup_jobs: Object.fromEntries(mockups.map((m) => [m.status, m.n])),
    mockup_loi_gan_nhat: mockups.find((m) => m.status === "failed")?.last_error?.slice(0, 200) || undefined,
    message: batches.length || mockups.length ? undefined : `Ngày ${vnDate(day)} bạn chưa tạo batch Trello hay job mockup nào, và không có job nào đang chạy.`,
    instructions:
      "Trả lời ngắn: batch nào xong / đang chạy / lỗi (xong X/Y card), liệt kê card lỗi kèm lý do. Mockup: số job xong / đang chạy / lỗi.",
  };
}

/** Số liệu thực tế tháng của 1 nhóm (dùng cho tóm tắt tuần). */
export function kpiHeadline(report: ReturnType<typeof summarizeKpi>["report"]) {
  return {
    revenue: money(report.revenue.cur ?? null),
    revenueTarget: money(report.revenue.tCur ?? null),
    revenuePct: pct1(report.revenue.kpi ?? null),
    gross: money(report.gross.cur ?? null),
    grossTarget: money(report.gross.tCur ?? null),
    grossPct: pct1(report.gross.kpi ?? null),
  };
}
