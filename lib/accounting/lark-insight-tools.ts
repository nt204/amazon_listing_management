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
  overstockSku,
  paceWindowStart,
  planRestock,
  salesPace,
  sameDayLastYear,
  shiftDate,
  upcomingEvents,
  type MonthUnits,
  type SeasonSource,
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
  // SKU OFF / Hủy vẫn còn tồn: dùng cho đánh giá dư thừa (không còn bán nhưng vẫn nằm kho)
  const stoppedItems = all.filter((r) => stopped(r.status));
  return { items, stoppedItems, snapshot, salesStart, salesEnd, stoppedCount: stoppedItems.length };
}

const INVENTORY_PACE_GUIDE =
  "Viết NGẮN, dễ hiểu. Mở đầu 1–2 câu: tồn chốt ngày, tình hình bán cả store (tinh_hinh_ban_ca_store): " +
  "kỳ so sánh bán N units, cùng kỳ năm ngoái M (±x%, ghi '(ước)' nếu nguồn là ước từ tổng tháng) → đánh giá; " +
  "dự kiến cả tháng ~K (năm ngoái cả tháng L). Không có năm ngoái thì nói xu hướng 14 ngày gần nhất. ";

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

  const demand = salesEnd ? await loadDemandContext(store.id, salesEnd) : null;
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
    ...(() => {
      if (!demand || x.unitsPerDay <= 0) return {};
      const p = demand.paceOf(x.sku, x.sellable, x.nextArrival);
      return {
        du_kien_het_hang: x.sellable > 0 ? p.stockoutDate ?? undefined : undefined,
        hang_ve_kip_truoc_khi_het: p.arrivesInTime ?? undefined,
        nhip_ban: shapePace(p),
      };
    })(),
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
      instructions:
        "Trả lời ngắn, dễ hiểu, tối đa ~6 dòng mỗi SKU: " +
        "1) Tồn: sẵn bán N, đang về M (ngày về), còn bán ~X ngày, dự kiến hết DD/MM (kịp/không kịp hàng về). " +
        "2) Bán tới hiện tại: kỳ so sánh bán N (x/ngày 14 ngày gần nhất). " +
        "3) So năm ngoái: cùng kỳ M → ±x% → đánh giá (Bứt tốc / Ổn định / Chậm lại); số năm ngoái 'ước' thì ghi (ước). " +
        "Không có năm ngoái thì so 14 ngày gần nhất với 14 ngày trước đó. " +
        "4) Dự báo: cả tháng ~K units (năm ngoái cả tháng L); gợi ý nhập thêm nếu có. Không tự tính lại số.",
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
    tinh_hinh_ban_ca_store: demand ? shapePace(demand.storePace(items.reduce((t, x) => t + x.sellable, 0))) : undefined,
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
      INVENTORY_PACE_GUIDE +
      "Rồi liệt kê đánh số theo mức: Hết hàng → Sắp hết → Cần nhập thêm. Mỗi SKU đúng 2 dòng: " +
      "(1) tồn sẵn bán · còn bán ~X ngày · dự kiến hết DD/MM · hàng đang về N (ngày về, kịp/không kịp trước khi hết) · gợi ý nhập thêm; " +
      "(2) nhịp bán: kỳ so sánh bán N vs năm ngoái M (±x%) → đánh giá; dự kiến cả tháng ~K (năm ngoái L). " +
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

// ───────────── Gợi ý nhập hàng theo mùa ─────────────

const HISTORY_DAYS = 56;

/** Thời gian đặt → hàng tới kho (trung vị lô 12 tháng gần nhất), thiếu dữ liệu thì dùng mặc định. */
async function storeLeadTime(storeId: string) {
  const sql = await getDatabaseClient();
  const [row] = await sql<Array<{ n: number; med: number | null }>>`
    SELECT COUNT(*)::int AS n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (LEFT(ngay_den, 10)::date - LEFT(ngay_request, 10)::date))::float AS med
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId} AND deleted_at IS NULL
      AND ngay_den ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND ngay_request ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      AND LEFT(ngay_request, 10) >= ${shiftDate(vnToday(), -365)}
      AND LEFT(ngay_den, 10) >= LEFT(ngay_request, 10)
  `;
  const fallback = envNum("LARK_RESTOCK_LEAD_DAYS", 45);
  if (row && row.n >= 5 && row.med != null && row.med > 0 && row.med < 180) {
    return { days: Math.round(row.med), source: `trung vị ${row.n} lô nhập 12 tháng qua (ngày request → ngày đến)` };
  }
  return { days: fallback, source: "mặc định (chưa đủ lịch sử lô nhập)" };
}

/** Units theo tháng: tháng có đủ đơn trong hệ thống lấy từ đơn hàng, tháng trước đó lấy từ số tổng kết 2025 (KPI). */
async function monthlyUnits(storeId: string, salesEnd: string) {
  const sql = await getDatabaseClient();
  const from = `${Number(salesEnd.slice(0, 4)) - 2}-01-01`;
  const [orders, history, first] = await Promise.all([
    sql<Array<{ sku: string; period: string; units: number }>>`
      SELECT UPPER(TRIM(sku)) AS sku, to_char(date, 'YYYY-MM') AS period, SUM(COALESCE(quantity, 1))::float AS units
      FROM accounting_orders
      WHERE store_id = ${storeId} AND date >= ${from}::date AND date <= ${salesEnd}::date
        AND fulfillment_channel = 'Amazon'
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
        AND COALESCE(TRIM(sku), '') <> ''
      GROUP BY 1, 2
    `,
    sql<Array<{ sku: string; period: string; units: number }>>`
      SELECT UPPER(TRIM(sku)) AS sku, period, SUM(quantity)::float AS units
      FROM accounting_kpi_sku_history
      WHERE store_id = ${storeId} AND variant = 'monthly' AND quantity > 0
      GROUP BY 1, 2
    `,
    sql<Array<{ d: string | null }>>`
      SELECT MIN(date)::text AS d FROM accounting_orders WHERE store_id = ${storeId} AND fulfillment_channel = 'Amazon'
    `,
  ]);
  // Tháng đủ dữ liệu đơn: bắt đầu từ ngày 01–02 và đã kết thúc (hoặc là tháng hiện tại)
  const firstDate = first[0]?.d || salesEnd;
  const firstFull = Number(firstDate.slice(8, 10)) <= 2 ? firstDate.slice(0, 7) : shiftDate(`${firstDate.slice(0, 7)}-28`, 5).slice(0, 7);
  const bySku = new Map<string, MonthUnits>();
  const put = (sku: string, period: string, units: number) => {
    let m = bySku.get(sku);
    if (!m) bySku.set(sku, (m = {}));
    m[period] = (m[period] ?? 0) + units;
  };
  for (const r of orders) if (r.period >= firstFull) put(r.sku, r.period, Number(r.units));
  for (const r of history) if (r.period < firstFull) put(r.sku, r.period, Number(r.units));
  return { bySku, coveredFrom: firstFull, firstDate };
}

/**
 * Dữ liệu bán dùng chung cho tồn kho / gợi ý nhập: units từng ngày 56 ngày gần nhất, units theo tháng (mùa vụ)
 * theo SKU → nhóm sản phẩm → cả store, và units cùng kỳ năm ngoái của kỳ so sánh (nếu năm ngoái đã có đơn từng ngày).
 */
async function loadDemandContext(storeId: string, today: string) {
  const sql = await getDatabaseClient();
  const winStart = paceWindowStart(today);
  const lyStart = sameDayLastYear(winStart);
  const lyEnd = sameDayLastYear(today);
  const [monthly, dailyRows, master, lyRows] = await Promise.all([
    monthlyUnits(storeId, today),
    sql<Array<{ sku: string; d: string; units: number }>>`
      SELECT UPPER(TRIM(sku)) AS sku, date::text AS d, SUM(COALESCE(quantity, 1))::float AS units
      FROM accounting_orders
      WHERE store_id = ${storeId}
        AND date > ${shiftDate(today, -HISTORY_DAYS)}::date AND date <= ${today}::date
        AND fulfillment_channel = 'Amazon'
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
        AND COALESCE(TRIM(sku), '') <> ''
      GROUP BY 1, 2
    `,
    sql<Array<{ sku: string; product_type: string | null }>>`
      SELECT DISTINCT ON (UPPER(TRIM(sku))) UPPER(TRIM(sku)) AS sku, product_type
      FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND UPPER(COALESCE(loai, 'FBA')) = 'FBA'
      ORDER BY UPPER(TRIM(sku)), updated_at DESC
    `,
    sql<Array<{ sku: string; units: number }>>`
      SELECT UPPER(TRIM(sku)) AS sku, SUM(COALESCE(quantity, 1))::float AS units
      FROM accounting_orders
      WHERE store_id = ${storeId}
        AND date BETWEEN ${lyStart}::date AND ${lyEnd}::date
        AND fulfillment_channel = 'Amazon'
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
        AND COALESCE(TRIM(sku), '') <> ''
      GROUP BY 1
    `,
  ]);

  // Chuỗi bán từng ngày
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < HISTORY_DAYS; i++) dayIndex.set(shiftDate(today, -(HISTORY_DAYS - 1) + i), i);
  const daily = new Map<string, number[]>();
  const storeDaily = new Array(HISTORY_DAYS).fill(0);
  for (const r of dailyRows) {
    const i = dayIndex.get(r.d);
    if (i == null) continue;
    let arr = daily.get(r.sku);
    if (!arr) daily.set(r.sku, (arr = new Array(HISTORY_DAYS).fill(0)));
    arr[i] += Number(r.units);
    storeDaily[i] += Number(r.units);
  }

  // Mùa vụ theo nhóm sản phẩm và cả store
  const typeOf = new Map(master.map((m) => [m.sku, m.product_type?.trim() || null]));
  const byType = new Map<string, MonthUnits>();
  const storeMonths: MonthUnits = {};
  for (const [sku, months] of monthly.bySku) {
    const t = typeOf.get(sku);
    for (const [p, u] of Object.entries(months)) {
      storeMonths[p] = (storeMonths[p] ?? 0) + u;
      if (t) {
        let m = byType.get(t);
        if (!m) byType.set(t, (m = {}));
        m[p] = (m[p] ?? 0) + u;
      }
    }
  }
  const seasonOf = (sku: string): SeasonSource => {
    const t = typeOf.get(sku) ?? null;
    return { sku: monthly.bySku.get(sku) ?? {}, productType: t ? byType.get(t) ?? null : null, store: storeMonths };
  };

  // Cùng kỳ năm ngoái theo đơn thật chỉ khi đơn đã có từ trước ngày đầu kỳ năm ngoái; không thì để salesPace ước từ tổng tháng
  const lyCovered = monthly.firstDate <= lyStart;
  const lyBySku = new Map(lyRows.map((r) => [r.sku, Number(r.units) || 0]));
  const lyStore = lyRows.reduce((s, r) => s + (Number(r.units) || 0), 0);

  const paceOf = (sku: string, sellable: number, nextArrival: string | null) =>
    salesPace(
      {
        daily: daily.get(sku) ?? new Array(HISTORY_DAYS).fill(0),
        lastYearWindow: lyCovered ? lyBySku.get(sku) ?? 0 : null,
        season: seasonOf(sku),
        sellable,
        nextArrival,
      },
      today,
    );
  const storePace = (sellable: number) =>
    salesPace(
      {
        daily: storeDaily,
        lastYearWindow: lyCovered ? lyStore : null,
        season: { sku: storeMonths, productType: null, store: storeMonths },
        sellable,
        nextArrival: null,
      },
      today,
    );

  return { monthly, daily, typeOf, seasonOf, paceOf, storePace };
}

const VERDICT_LABEL = {
  but_toc: "Bứt tốc",
  on_dinh: "Ổn định",
  cham_lai: "Chậm lại",
  it_don: "Ít đơn, chưa đủ để kết luận",
} as const;

/** Nhịp bán gọn cho bot: kỳ này vs cùng kỳ năm ngoái, xu hướng 14 ngày, dự kiến cả tháng / ngày hết hàng. */
function shapePace(p: ReturnType<typeof salesPace>) {
  return {
    ky_so_sanh: `${vnDate(p.windowStart)}–${vnDate(p.windowEnd)}`,
    da_ban: p.units,
    nam_ngoai_cung_ky: p.lastYear,
    nguon_nam_ngoai: p.lastYearSource === "uoc_tu_tong_thang" ? "ước từ tổng tháng năm ngoái (chưa có đơn từng ngày)" : p.lastYearSource === "don_hang" ? "đơn hàng năm ngoái" : "chưa có dữ liệu năm ngoái",
    so_voi_nam_ngoai_pct: p.vsLastYearPct,
    ban_moi_ngay_14_ngay: p.last14PerDay,
    ban_moi_ngay_14_ngay_truoc: p.prev14PerDay,
    xu_huong_14_ngay_pct: p.trend14Pct,
    danh_gia: VERDICT_LABEL[p.verdict],
    danh_gia_theo: p.verdict === "it_don" ? undefined : p.vsLastYearPct != null ? "so với cùng kỳ năm ngoái" : "14 ngày gần nhất so với 14 ngày trước đó",
    thang_nay_da_ban: p.monthSoFar,
    du_kien_ca_thang: p.monthForecast,
    nam_ngoai_ca_thang: p.lastYearMonth,
  };
}

export async function getRestockPlan(params: {
  storeQuery?: string;
  sku?: string;
  coverDays?: number;
  leadTimeDays?: number;
  limit?: number;
}) {
  const store = await resolveAccountingStoreExact(params.storeQuery);
  if (!store) return needStore(params.storeQuery);

  const th = stockThresholds();
  const stock = await loadStockRows(store.id, th);
  if (!stock.snapshot || !stock.salesEnd) {
    return { hasData: false, store: store.name, message: `Chưa có dữ liệu tồn kho (Inventory Ledger) hoặc đơn FBA của ${store.name} nên chưa gợi ý nhập được.` };
  }
  const today = stock.salesEnd;
  const [lead, demand] = await Promise.all([storeLeadTime(store.id), loadDemandContext(store.id, today)]);
  const { monthly, daily, typeOf, seasonOf } = demand;

  const clampInt = (v: number | undefined, d: number, min: number, max: number) =>
    v != null && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
  const settings = {
    leadTimeDays: clampInt(params.leadTimeDays, lead.days, 7, 150),
    coverDays: clampInt(params.coverDays, envNum("LARK_RESTOCK_COVER_DAYS", 30), 14, 120),
    z: 1.65,
  };

  const wanted = params.sku?.trim().toUpperCase();
  const plans = stock.items
    .filter((x) => x.hasBalance !== false)
    .filter((x) => (wanted ? x.sku === wanted || x.sku.includes(wanted) : (daily.get(x.sku)?.some((u) => u > 0) ?? false)))
    .map((x) => {
      const t = typeOf.get(x.sku) ?? null;
      return planRestock(
        {
          sku: x.sku,
          status: x.status,
          productType: t,
          daily: daily.get(x.sku) ?? new Array(HISTORY_DAYS).fill(0),
          sellable: x.sellable,
          inTransit: x.inTransit,
          inboundPending: x.inboundPending,
          nextArrival: x.nextArrival,
          season: seasonOf(x.sku),
        },
        today,
        settings,
      );
    });

  const soon = shiftDate(today, 30);
  const ranked = (wanted ? plans : plans.filter((p) => p.suggestUnits > 0 && (p.orderNow || (p.orderByDate != null && p.orderByDate <= soon))))
    .sort((a, b) => (a.orderByDate ?? "9999").localeCompare(b.orderByDate ?? "9999") || b.suggestUnits - a.suggestUnits);
  const limit = Math.min(25, Math.max(1, params.limit || 12));

  const horizonEnd = shiftDate(today, settings.leadTimeDays + settings.coverDays);
  const levelVi = { sku: "lịch sử chính SKU", product_type: "nhóm sản phẩm", store: "cả store", none: "chưa có cùng kỳ năm trước" } as const;
  const notes: string[] = [];
  if (stock.snapshot < shiftDate(today, -3)) notes.push(`Tồn kho chốt ngày ${vnDate(stock.snapshot)}, cũ hơn dữ liệu đơn (${vnDate(today)}).`);
  if (monthly.coveredFrom > shiftDate(today, -365).slice(0, 7)) {
    notes.push(`Đơn hàng có đủ từ ${monthly.coveredFrom}; tháng trước đó dùng số tổng kết theo tháng (nếu có) để tính mùa vụ.`);
  }
  notes.push("Ngày hết hàng trong quá khứ làm tốc độ bán bị thấp hơn nhu cầu thật; SKU từng hết hàng gần đây nên cộng thêm.");

  return {
    hasData: ranked.length > 0,
    store: store.name,
    du_lieu_ban_toi: today,
    ton_kho_chot_ngay: stock.snapshot,
    gia_dinh: {
      thoi_gian_cho_hang_ngay: settings.leadTimeDays,
      nguon_thoi_gian_cho: params.leadTimeDays ? "người dùng nêu" : lead.source,
      lo_moi_du_ban_ngay: settings.coverDays,
      ton_an_toan: "Z 1.65 (≈95% không hết hàng) × độ dao động bán/ngày 56 ngày × √thời gian chờ",
      toc_do_nen: "40% TB 14 ngày + 40% TB 28 ngày + 20% TB 56 ngày",
      mua_vu: "hệ số = units tháng đó năm trước ÷ units tháng hiện tại năm trước (theo SKU → nhóm sản phẩm → cả store, giới hạn 0.3–5)",
    },
    su_kien_sap_toi: upcomingEvents(shiftDate(today, 1), horizonEnd),
    tong_sku_dang_ban: plans.length,
    can_dat_ngay: plans.filter((p) => p.orderNow && p.suggestUnits > 0).length,
    skus: ranked.slice(0, limit).map((p) => ({
      sku: p.sku,
      trang_thai: p.status,
      nhom: p.productType,
      ban_nen_moi_ngay: p.baseUnitsPerDay,
      so_voi_nam_ngoai: (() => {
        const v = demand.paceOf(p.sku, p.sellable, p.nextArrival);
        if (v.lastYear == null) return "chưa có cùng kỳ năm ngoái";
        const pct = v.vsLastYearPct == null ? "" : ` (${v.vsLastYearPct >= 0 ? "+" : ""}${v.vsLastYearPct}%)`;
        return `${vnDate(v.windowStart)}–${vnDate(v.windowEnd)} bán ${v.units} vs năm ngoái ${v.lastYear}${v.lastYearSource === "uoc_tu_tong_thang" ? " (ước)" : ""}${pct} → ${VERDICT_LABEL[v.verdict]}`;
      })(),
      xu_huong_28_ngay_pct: p.trend28Pct,
      he_so_mua: p.seasonByMonth.map((m) => `${m.period}: x${m.factor} (${levelVi[m.level]}${m.clamped ? ", đã giới hạn — thực tế năm trước còn chênh hơn" : ""})`),
      ton_san_ban: p.sellable,
      hang_dang_ve: p.coming || undefined,
      ngay_ve_gan_nhat: p.nextArrival || undefined,
      du_kien_het_hang: p.stockoutDate,
      dat_hang_truoc_ngay: p.orderByDate,
      can_dat_ngay: p.orderNow,
      nhu_cau_du_bao: p.demandTotal,
      ton_an_toan: p.safetyStock,
      goi_y_nhap: p.suggestUnits,
      do_tin_cay: p.confidence,
      luu_y: /^test$/i.test(String(p.status ?? "").trim()) ? "SKU Test: nên nhập lô nhỏ để thử" : undefined,
    })),
    con_lai: Math.max(0, ranked.length - limit),
    message: ranked.length ? undefined : `Chưa có SKU nào của ${store.name} cần đặt hàng trong 30 ngày tới theo dự báo.`,
    ghi_chu: notes,
    instructions:
      "Mở đầu: store, dữ liệu bán tới ngày, giả định (thời gian chờ hàng X ngày – nguồn, lô mới đủ bán Y ngày), sự kiện mua sắm sắp tới. " +
      "Rồi danh sách đánh số theo hạn đặt hàng: SKU · gợi ý nhập N units · đặt trước ngày DD/MM (hoặc 'đặt ngay') · dự kiến hết hàng DD/MM. " +
      "Dòng 2 nêu LÝ DO ngắn: bán nền x/ngày, so với năm ngoái (so_voi_nam_ngoai), xu hướng, hệ số mùa các tháng (nguồn), tồn + hàng đang về, độ tin cậy. " +
      "Đây là GỢI Ý dự báo, không khẳng định; độ tin cậy thấp thì nói rõ. Không tự tính lại số.",
  };
}

// ───────────── Xếp hạng tồn kho & nguy cơ dư thừa giữa các store ─────────────

/**
 * Mọi store (trong phạm vi được xem): tổng tồn, giá trị tồn theo Base Cost, nhu cầu dự báo tới hết năm (mùa vụ),
 * phần dư thừa ước tính và SKU dư nhiều nhất. Xếp hạng tính sẵn ở đây để bot hỏi lần nào cũng ra cùng một kết quả.
 */
export async function getOverstockRanking(params: { storeNames?: string[]; untilDate?: string; topSkus?: number }) {
  const all = await listStores();
  const wanted = params.storeNames?.length ? new Set(params.storeNames.map((n) => n.trim().toLowerCase())) : null;
  const stores = all.filter((s) => !wanted || wanted.has(String(s.name).toLowerCase()));
  const th = stockThresholds();
  const topN = Math.min(10, Math.max(1, params.topSkus || 5));
  const sql = await getDatabaseClient();
  const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

  const rows = await Promise.all(
    stores.map(async (store) => {
      const stock = await loadStockRows(store.id, th);
      if (!stock.snapshot || !stock.salesEnd) return { store: store.name, hasData: false as const };
      const today = stock.salesEnd;
      const yearEnd = `${today.slice(0, 4)}-12-31`;
      // "Năm nay": tới 31/12; cuối năm còn < 30 ngày thì tính 30 ngày tới
      const horizonEnd =
        isDate(params.untilDate) && params.untilDate! > today
          ? params.untilDate!
          : yearEnd > shiftDate(today, 30)
            ? yearEnd
            : shiftDate(today, 30);
      const [demand, costRows] = await Promise.all([
        loadDemandContext(store.id, today),
        sql<Array<{ sku: string; cost: number }>>`
          SELECT DISTINCT ON (UPPER(TRIM(sku))) UPPER(TRIM(sku)) AS sku, basecost_thang::float AS cost
          FROM accounting_monthly_base_cost
          WHERE store_id = ${store.id} AND deleted_at IS NULL AND basecost_thang > 0
          ORDER BY UPPER(TRIM(sku)), period DESC
        `,
      ]);
      const cost = new Map(costRows.map((r) => [r.sku, Number(r.cost) || 0]));
      const stoppedSet = new Set(stock.stoppedItems.map((x) => x.sku));
      const skus = [...stock.items, ...stock.stoppedItems]
        .filter((x) => x.hasBalance !== false)
        .map((x) => {
          const o = overstockSku(
            {
              daily: demand.daily.get(x.sku) ?? new Array(HISTORY_DAYS).fill(0),
              season: demand.seasonOf(x.sku),
              sellable: x.sellable,
              coming: x.inTransit + x.inboundPending,
            },
            today,
            horizonEnd,
          );
          return { sku: x.sku, status: x.status, stopped: stoppedSet.has(x.sku), unit: cost.get(x.sku) ?? null, ...o };
        })
        .filter((x) => x.stock > 0);

      const sum = (f: (x: (typeof skus)[number]) => number) => skus.reduce((t, x) => t + f(x), 0);
      const val = (units: number, unit: number | null) => (unit == null ? 0 : units * unit);
      const stockUnits = sum((x) => x.stock);
      const excessUnits = sum((x) => x.excess);
      const top = skus
        .filter((x) => x.excess > 0)
        .sort((a, b) => val(b.excess, b.unit) - val(a.excess, a.unit) || b.excess - a.excess)
        .slice(0, topN);
      return {
        store: store.name,
        hasData: true as const,
        snapshot: stock.snapshot,
        salesEnd: today,
        horizonEnd,
        stockUnits,
        stockValue: sum((x) => val(x.stock, x.unit)),
        demandUnits: sum((x) => Math.min(x.demand, x.stock)),
        excessUnits,
        excessValue: sum((x) => val(x.excess, x.unit)),
        excessPct: stockUnits > 0 ? excessUnits / stockUnits : 0,
        deadSkus: skus.filter((x) => x.noSales).length,
        stoppedWithStock: skus.filter((x) => x.stopped).length,
        missingCost: skus.filter((x) => x.unit == null).length,
        top,
      };
    }),
  );

  type Ok = Extract<(typeof rows)[number], { hasData: true }>;
  const ok = rows.filter((r): r is Ok => r.hasData);
  if (!ok.length) return { hasData: false, message: "Chưa có dữ liệu tồn kho (Inventory Ledger) của store nào." };
  const byExcess = [...ok].sort((a, b) => b.excessValue - a.excessValue || b.excessUnits - a.excessUnits);
  const byStock = [...ok].sort((a, b) => b.stockValue - a.stockValue || b.stockUnits - a.stockUnits);
  const usd = (v: number) => Math.round(v);
  const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
  const notes: string[] = [];
  const noCost = ok.filter((r) => r.missingCost > 0);
  if (noCost.length) {
    notes.push(`Một số SKU chưa có Base Cost nên chưa quy ra $ (${noCost.map((r) => `${r.store}: ${r.missingCost} SKU`).join(", ")}); số units vẫn đủ.`);
  }
  const stale = ok.filter((r) => r.snapshot < shiftDate(r.salesEnd, -3));
  if (stale.length) notes.push(`Tồn kho chốt cũ hơn dữ liệu đơn: ${stale.map((r) => `${r.store} (${vnDate(r.snapshot)})`).join(", ")}.`);
  const missing = rows.filter((r) => !r.hasData).map((r) => r.store);
  if (missing.length) notes.push(`Chưa có dữ liệu tồn kho: ${missing.join(", ")}.`);

  return {
    hasData: true,
    cach_tinh: {
      ton: "tồn sẵn bán + đang chuyển kho + lô đang về (gồm cả SKU OFF / Hủy còn tồn)",
      nhu_cau: "bán dự báo từ ngày có đơn mới nhất tới hết năm: tốc độ nền (40% TB 14 + 40% TB 28 + 20% TB 56 ngày) × hệ số mùa năm trước",
      du_thua: "tồn − nhu cầu dự báo = phần dự kiến còn nằm kho sau cuối kỳ, quy $ theo Base Cost tháng gần nhất",
    },
    xep_hang_ton_nhieu_nhat: byStock.map((r, i) => `${i + 1}. ${r.store}: ${fmt(r.stockUnits)} units ≈ $${fmt(r.stockValue)}`),
    xep_hang_du_thua: byExcess.map((r, i) => ({
      hang: i + 1,
      store: r.store,
      du_thua_units: r.excessUnits,
      du_thua_usd: usd(r.excessValue),
      ty_le_du_thua_pct: Math.round(r.excessPct * 100),
      ton_units: r.stockUnits,
      ton_usd: usd(r.stockValue),
      du_kien_ban_toi: `${vnDate(r.horizonEnd)}: ${fmt(r.demandUnits)} units`,
      sku_co_ton_khong_ban_56_ngay: r.deadSkus,
      sku_off_huy_con_ton: r.stoppedWithStock || undefined,
      ton_chot_ngay: r.snapshot,
      sku_du_nhieu_nhat: r.top.map((x) => ({
        sku: x.sku,
        trang_thai: x.status,
        ton: x.stock,
        ban_moi_ngay: x.basePerDay,
        du_kien_ban_toi_cuoi_ky: x.demand,
        du_thua: x.excess,
        du_thua_usd: x.unit == null ? null : usd(x.excess * x.unit),
        so_ngay_ban_het: x.coverDays ?? (x.noSales ? "không bán" : "> 2 năm"),
      })),
    })),
    ghi_chu: notes,
    instructions:
      "Trả lời NGẮN theo đúng thứ hạng đã tính sẵn, KHÔNG tự xếp lại hay suy luận từ vài SKU. " +
      "1) Tồn nhiều nhất: đọc xep_hang_ton_nhieu_nhat (units + $). " +
      "2) Nguy cơ dư thừa tới cuối năm theo xep_hang_du_thua, mỗi store 1 dòng: dư ~N units (~$X, Y% tồn), dự kiến bán tới cuối kỳ. " +
      "3) Store đứng đầu: 3–5 SKU dư nhiều nhất (tồn, bán/ngày, dư, số ngày bán hết). " +
      "Nói rõ đây là ước tính theo tốc độ bán + mùa vụ năm trước. Nêu ghi_chu nếu có.",
  };
}
