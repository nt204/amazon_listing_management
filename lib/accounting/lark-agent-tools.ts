import "server-only";

import crypto from "node:crypto";
import { getDatabaseClient } from "@/lib/db";
import { invalidateCachePattern } from "@/lib/redis";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { exportBulksheetUpdateExcel, exportSaleKwBulksheetExcel, type SaleKwCampaignPayload } from "@/lib/ppc/service";
import {
  isAsinProductTarget,
  generateSaleKwCampaignTriad,
  normalizeSaleKwDate,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";
import type { PpcRecommendation } from "@/lib/ppc/types";
import { listStores } from "./accounting-db";
import { listFbaDaily } from "./fba-daily-db";
import {
  setPendingAction,
  setLastListedCandidates,
  getLastListedCandidates,
  setLastSaleKwCandidates,
  getLastSaleKwCandidates,
  PendingPpcAction,
  PendingNegativeItem,
  PendingSaleKwItem,
} from "./lark-conversation-memory";

export interface StoreInfo {
  id: string;
  name: string;
  marketplace: string;
}

/**
 * Lấy danh sách hoặc tìm store theo tên/alias
 */
export async function resolveStore(storeQuery?: string): Promise<StoreInfo | null> {
  const stores = await listStores();
  if (!storeQuery || !storeQuery.trim()) return null;
  const q = storeQuery.trim().toLowerCase();

  const found = stores.find((s) => 
    s.id === storeQuery ||
    s.name.toLowerCase() === q ||
    s.name.toLowerCase().includes(q) ||
    q.includes(s.name.toLowerCase())
  );

  if (found) {
    return { id: found.id, name: found.name, marketplace: found.marketplace };
  }
  return null;
}

export async function getAllStores(): Promise<StoreInfo[]> {
  const stores = await listStores();
  return stores.map(s => ({ id: s.id, name: s.name, marketplace: s.marketplace }));
}

/**
 * 1. Tra cứu P&L & Doanh thu theo ngày/khoảng ngày
 */
export async function getDailyMetricsSummary(params: {
  storeQuery?: string;
  startDate: string;
  endDate: string;
}) {
  const sql = await getDatabaseClient();
  const allStores = await getAllStores();
  const targetStore = params.storeQuery ? await resolveStore(params.storeQuery) : null;

  if (params.storeQuery && !targetStore) {
    return {
      hasData: false,
      store: params.storeQuery,
      error: `Không tìm thấy store "${params.storeQuery}". Hệ thống hiện có 5 store: ${allStores.map((s) => s.name).join(", ")}.`,
    };
  }

  const storeIds = targetStore ? [targetStore.id] : allStores.map((s) => s.id);
  if (storeIds.length === 0) {
    return { hasData: false, error: "Không tìm thấy store phù hợp trong hệ thống." };
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const yDate = new Date();
  yDate.setDate(yDate.getDate() - 1);
  const yesterdayStr = `${yDate.getFullYear()}-${pad(yDate.getMonth() + 1)}-${pad(yDate.getDate())}`;

  // Nếu là 1 store, dùng listFbaDaily để tính toán chuẩn nhất
  if (targetStore) {
    const res = await listFbaDaily(targetStore.id, {
      startDate: params.startDate,
      endDate: params.endDate,
      limit: 100,
      sortDirection: "asc",
    });

    const hasRecords = res.items.length > 0;
    const actualStartDate = hasRecords ? res.items[0].date : params.startDate;
    const actualEndDate = hasRecords ? res.items[res.items.length - 1].date : params.endDate;
    const actualDays = res.items.length;
    const days = res.items.map((it) => ({
      date: it.date,
      revenue: Math.round(it.revenue),
      quantity: it.quantity,
      ads_fee: Math.round(it.ads_fee),
      amazon_fee: Math.round(it.amazon_fee),
      return_cost: Math.round(it.return_cost),
      profit: Math.round(it.profit),
      net_profit: Math.round(it.net_profit),
      acos: it.revenue_ads > 0 ? Number(((it.ads_fee / it.revenue_ads) * 100).toFixed(1)) : 0,
      tacos: it.revenue > 0 ? Number(((it.ads_fee / it.revenue) * 100).toFixed(1)) : 0,
      margin: it.revenue > 0 ? Number(((it.profit / it.revenue) * 100).toFixed(1)) : 0,
    }));

    return {
      hasData: hasRecords,
      message: hasRecords ? undefined : `Không có dữ liệu kế toán cho store ${targetStore.name} từ ${params.startDate} đến ${params.endDate}.`,
      store: targetStore.name,
      marketplace: targetStore.marketplace,
      period: {
        startDate: params.startDate,
        endDate: params.endDate,
        actualStartDate,
        actualEndDate,
        actualDays,
      },
      latestAvailableDate: actualEndDate,
      periodNote: actualEndDate < params.endDate
        ? `Dữ liệu kế toán FBA thực tế mới có đến ngày ${actualEndDate} (tổng cộng ${actualDays} ngày). Các ngày sau đó (${actualEndDate} -> ${params.endDate}) sàn Amazon chưa có dữ liệu.`
        : undefined,
      totalDays: actualDays,
      totals: {
        totalRevenue: Math.round(res.stats.totalRevenue),
        totalQuantity: res.stats.totalQuantity,
        totalAdsFee: Math.round(res.stats.totalAdsFee),
        totalAmazonFee: Math.round(res.stats.totalAmazonFee),
        totalReturnCost: Math.round(res.stats.totalReturnCost),
        totalProfit: Math.round(res.stats.totalProfit),
        totalNetProfit: Math.round(res.stats.totalNetProfit),
        avgAcos: Number(res.stats.avgAcos.toFixed(1)),
        avgTacos: Number(res.stats.avgTacos.toFixed(1)),
        avgMargin: Number(res.stats.avgMargin.toFixed(1)),
      },
      dailyDetails: days.slice(0, 31), // Giới hạn tối đa 31 ngày chi tiết
    };
  }

  // Tổng hợp tất cả stores
  const storeReports = await Promise.all(
    allStores.map(async (st) => {
      const res = await listFbaDaily(st.id, {
        startDate: params.startDate,
        endDate: params.endDate,
        limit: 100,
        sortDirection: "asc",
      });
      return {
        storeName: st.name,
        stats: res.stats,
        items: res.items,
      };
    })
  );

  const allDates = Array.from(
    new Set(storeReports.flatMap((r) => r.items.map((it) => it.date)))
  ).sort();
  const hasRecords = allDates.length > 0;
  const actualStartDate = hasRecords ? allDates[0] : params.startDate;
  const actualEndDate = hasRecords ? allDates[allDates.length - 1] : params.endDate;
  const actualDays = allDates.length;

  const grandTotal = storeReports.reduce(
    (acc, cur) => {
      acc.totalRevenue += cur.stats.totalRevenue;
      acc.totalQuantity += cur.stats.totalQuantity;
      acc.totalAdsFee += cur.stats.totalAdsFee;
      acc.totalAmazonFee += cur.stats.totalAmazonFee;
      acc.totalReturnCost += cur.stats.totalReturnCost;
      acc.totalProfit += cur.stats.totalProfit;
      acc.totalNetProfit += cur.stats.totalNetProfit;
      return acc;
    },
    {
      totalRevenue: 0,
      totalQuantity: 0,
      totalAdsFee: 0,
      totalAmazonFee: 0,
      totalReturnCost: 0,
      totalProfit: 0,
      totalNetProfit: 0,
    }
  );

  const activeReports = storeReports.filter(
    (r) => r.stats.totalRevenue > 0 || r.stats.totalQuantity > 0 || r.stats.totalProfit !== 0
  );

  const breakdown = activeReports.map((r) => ({
    store: r.storeName,
    revenue: Math.round(r.stats.totalRevenue),
    quantity: r.stats.totalQuantity,
    adsFee: Math.round(r.stats.totalAdsFee),
    amazonFee: Math.round(r.stats.totalAmazonFee),
    returnCost: Math.round(r.stats.totalReturnCost),
    profit: Math.round(r.stats.totalProfit),
    netProfit: Math.round(r.stats.totalNetProfit),
    margin: r.stats.totalRevenue > 0 ? Number(((r.stats.totalProfit / r.stats.totalRevenue) * 100).toFixed(1)) : 0,
  }));

  const rankingByProfit = [...breakdown].sort((a, b) => b.profit - a.profit);
  const rankingByNetProfit = [...breakdown].sort((a, b) => b.netProfit - a.netProfit);
  const rankingByRevenue = [...breakdown].sort((a, b) => b.revenue - a.revenue);

  return {
    scope: "Tất cả các store",
    hasData: hasRecords,
    period: {
      startDate: params.startDate,
      endDate: params.endDate,
      actualStartDate,
      actualEndDate,
      actualDays,
    },
    latestAvailableDate: actualEndDate,
    totalDays: actualDays,
    periodNote: actualEndDate < params.endDate
      ? `Dữ liệu kế toán FBA thực tế mới có đến ngày ${actualEndDate} (tổng cộng ${actualDays} ngày). Các ngày sau đó (${actualEndDate} -> ${params.endDate}) sàn Amazon chưa có dữ liệu đối soát.`
      : undefined,
    storeBreakdown: breakdown,
    rankingByProfit,
    rankingByNetProfit,
    rankingByRevenue,
    topStore: {
      byProfit: rankingByProfit[0] || null,
      byNetProfit: rankingByNetProfit[0] || null,
      byRevenue: rankingByRevenue[0] || null,
    },
    totals: {
      totalRevenue: Math.round(grandTotal.totalRevenue),
      totalQuantity: grandTotal.totalQuantity,
      totalAdsFee: Math.round(grandTotal.totalAdsFee),
      totalAmazonFee: Math.round(grandTotal.totalAmazonFee),
      totalReturnCost: Math.round(grandTotal.totalReturnCost),
      totalProfit: Math.round(grandTotal.totalProfit),
      totalNetProfit: Math.round(grandTotal.totalNetProfit),
      avgMargin:
        grandTotal.totalRevenue > 0
          ? Number(((grandTotal.totalProfit / grandTotal.totalRevenue) * 100).toFixed(1))
          : 0,
    },
  };
}

/**
 * 2. Tra cứu chi tiết Orders & SKU Performance
 */
export async function getOrderBreakdown(params: {
  storeQuery?: string;
  startDate: string;
  endDate: string;
  sku?: string;
  limit?: number;
}) {
  const sql = await getDatabaseClient();
  const targetStore = params.storeQuery ? await resolveStore(params.storeQuery) : null;
  const storeId = targetStore ? targetStore.id : null;
  const skuQuery = params.sku?.trim() || null;
  const limit = Math.min(params.limit || 10, 50);

  // Top SKUs by quantity & revenue
  const skuRows = await sql<Array<{
    sku: string;
    product_name: string | null;
    total_orders: number;
    total_units: number;
    total_rev: number;
  }>>`
    SELECT
      sku,
      MAX(product_name) as product_name,
      COUNT(DISTINCT amazon_order_id) as total_orders,
      SUM(COALESCE(quantity, 1)) as total_units,
      SUM(COALESCE(item_price, 0)) as total_rev
    FROM accounting_orders
    WHERE date >= ${params.startDate}::date
      AND date <= ${params.endDate}::date
      AND fulfillment_channel = 'Amazon'
      AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
      ${storeId ? sql`AND store_id = ${storeId}` : sql``}
      ${skuQuery ? sql`AND sku ILIKE ${"%" + skuQuery + "%"}` : sql``}
    GROUP BY sku
    ORDER BY total_units DESC
    LIMIT ${limit}
  `;

  // Status breakdown
  const statusRows = await sql<Array<{ order_status: string | null; count: number }>>`
    SELECT order_status, COUNT(*) as count
    FROM accounting_orders
    WHERE date >= ${params.startDate}::date
      AND date <= ${params.endDate}::date
      ${storeId ? sql`AND store_id = ${storeId}` : sql``}
      ${skuQuery ? sql`AND sku ILIKE ${"%" + skuQuery + "%"}` : sql``}
    GROUP BY order_status
  `;

  const hasRecords = skuRows.length > 0;
  return {
    hasData: hasRecords,
    message: hasRecords ? undefined : `Không có dữ liệu đơn hàng nào ${skuQuery ? `cho SKU "${skuQuery}"` : ""} từ ${params.startDate} đến ${params.endDate}.`,
    store: targetStore ? targetStore.name : "Tất cả các store",
    period: { startDate: params.startDate, endDate: params.endDate },
    filterSku: skuQuery,
    statusBreakdown: statusRows.map((r) => ({ status: r.order_status || "Unknown", count: Number(r.count) })),
    topSkus: skuRows.map((r) => ({
      sku: r.sku,
      productName: r.product_name,
      orders: Number(r.total_orders),
      units: Number(r.total_units),
      revenue: Math.round(Number(r.total_rev)),
    })),
  };
}

/**
 * 3. Tra cứu chi tiết Hoàn trả (Returns)
 */
export async function getReturnBreakdown(params: {
  storeQuery?: string;
  startDate: string;
  endDate: string;
  sku?: string;
}) {
  const sql = await getDatabaseClient();
  const targetStore = params.storeQuery ? await resolveStore(params.storeQuery) : null;
  const storeId = targetStore ? targetStore.id : null;
  const skuQuery = params.sku?.trim() || null;

  const summaryRows = await sql<Array<{
    total_returns: number;
    total_refund_amount: number;
  }>>`
    SELECT
      COUNT(*) as total_returns,
      SUM(COALESCE(return_sau_basecost, 0)) as total_refund_amount
    FROM accounting_returns
    WHERE date >= ${params.startDate}::date
      AND date <= ${params.endDate}::date
      ${storeId ? sql`AND store_id = ${storeId}` : sql``}
      ${skuQuery ? sql`AND sku ILIKE ${"%" + skuQuery + "%"}` : sql``}
  `;

  const topReturnedSkus = await sql<Array<{
    sku: string;
    return_count: number;
    total_cost: number;
  }>>`
    SELECT
      sku,
      COUNT(*) as return_count,
      SUM(COALESCE(return_sau_basecost, 0)) as total_cost
    FROM accounting_returns
    WHERE date >= ${params.startDate}::date
      AND date <= ${params.endDate}::date
      ${storeId ? sql`AND store_id = ${storeId}` : sql``}
      ${skuQuery ? sql`AND sku ILIKE ${"%" + skuQuery + "%"}` : sql``}
    GROUP BY sku
    ORDER BY return_count DESC
    LIMIT 10
  `;

  return {
    store: targetStore ? targetStore.name : "Tất cả các store",
    period: { startDate: params.startDate, endDate: params.endDate },
    totalReturns: Number(summaryRows[0]?.total_returns || 0),
    totalRefundCost: Math.round(Number(summaryRows[0]?.total_refund_amount || 0)),
    topReturnedSkus: topReturnedSkus.map((r) => ({
      sku: r.sku,
      returnCount: Number(r.return_count),
      refundCost: Math.round(Number(r.total_cost)),
    })),
  };
}

/**
 * 4. So sánh hai chu kỳ (Compare Periods - Like-for-Like Apple-to-Apple)
 */
export async function comparePerformancePeriods(params: {
  storeQuery?: string;
  period1: { startDate: string; endDate: string; label?: string };
  period2: { startDate: string; endDate: string; label?: string };
}) {
  // Lấy dữ liệu chu kỳ 2 trước để xác định chính xác ngày có dữ liệu thực tế (actualEndDate, actualDays)
  const p2 = await getDailyMetricsSummary({
    storeQuery: params.storeQuery,
    startDate: params.period2.startDate,
    endDate: params.period2.endDate,
  });

  if ("error" in p2 || !p2.hasData) {
    return { error: ("error" in p2 && p2.error) || "Không lấy được dữ liệu cho chu kỳ 2." };
  }

  const p2ActualDays = p2.totalDays || p2.period?.actualDays || 0;
  const p2ActualStart = p2.period?.actualStartDate || params.period2.startDate;
  const p2ActualEnd = p2.period?.actualEndDate || params.period2.endDate;

  // Căn chỉnh Chu kỳ 1 (Baseline) cho đúng số ngày Like-for-Like với Chu kỳ 2
  let p1StartDate = params.period1.startDate;
  let p1EndDate = params.period1.endDate;
  let periodAligned = false;

  if (p2ActualDays > 0) {
    const p1Start = new Date(p1StartDate + "T00:00:00Z");
    const p2Start = new Date(params.period2.startDate + "T00:00:00Z");
    const p2End = new Date(p2ActualEnd + "T00:00:00Z");

    // Nếu cả 2 chu kỳ cùng bắt đầu từ ngày mùng 1 của tháng (ví dụ so sánh tháng này vs tháng trước)
    if (p1Start.getUTCDate() === 1 && p2Start.getUTCDate() === 1) {
      const p1Year = p1Start.getUTCFullYear();
      const p1Month = p1Start.getUTCMonth(); // 0-indexed
      const targetDay = p2End.getUTCDate();
      const maxDaysInP1Month = new Date(Date.UTC(p1Year, p1Month + 1, 0)).getUTCDate();
      const alignedDay = Math.min(targetDay, maxDaysInP1Month);
      const pad = (n: number) => String(n).padStart(2, "0");
      const targetP1End = `${p1Year}-${pad(p1Month + 1)}-${pad(alignedDay)}`;
      if (targetP1End !== p1EndDate) {
        p1EndDate = targetP1End;
        periodAligned = true;
      }
    } else {
      // Trường hợp khoảng ngày tùy biến: căn chỉnh đúng số ngày thực tế
      const targetTime = p1Start.getTime() + (p2ActualDays - 1) * 86400000;
      const targetDate = new Date(targetTime);
      const targetP1End = targetDate.toISOString().slice(0, 10);
      if (targetP1End !== p1EndDate) {
        p1EndDate = targetP1End;
        periodAligned = true;
      }
    }
  }

  const p1 = await getDailyMetricsSummary({
    storeQuery: params.storeQuery,
    startDate: p1StartDate,
    endDate: p1EndDate,
  });

  if ("error" in p1 || !p1.hasData) {
    return { error: ("error" in p1 && p1.error) || "Không lấy được dữ liệu cho chu kỳ 1." };
  }

  const p1ActualDays = p1.totalDays || p1.period?.actualDays || 0;
  const p1ActualStart = p1.period?.actualStartDate || p1StartDate;
  const p1ActualEnd = p1.period?.actualEndDate || p1EndDate;

  const calcDiff = (v2: number, v1: number) => {
    const diff = v2 - v1;
    const pct = v1 !== 0 ? Number(((diff / Math.abs(v1)) * 100).toFixed(1)) : v2 > 0 ? 100 : 0;
    return {
      period1: v1,
      period2: v2,
      diff,
      pctChange: pct,
    };
  };

  const t1 = p1.totals;
  const t2 = p2.totals;

  const p1Label = params.period1.label
    ? `${params.period1.label} (${p1ActualStart} -> ${p1ActualEnd}, ${p1ActualDays} ngày)`
    : `${p1ActualStart} -> ${p1ActualEnd} (${p1ActualDays} ngày)`;

  const p2Label = params.period2.label
    ? `${params.period2.label} (${p2ActualStart} -> ${p2ActualEnd}, ${p2ActualDays} ngày)`
    : `${p2ActualStart} -> ${p2ActualEnd} (${p2ActualDays} ngày)`;

  return {
    store: params.storeQuery || "Tất cả các store",
    period1: {
      startDate: p1ActualStart,
      endDate: p1ActualEnd,
      totalDays: p1ActualDays,
      label: p1Label,
    },
    period2: {
      startDate: p2ActualStart,
      endDate: p2ActualEnd,
      totalDays: p2ActualDays,
      label: p2Label,
      latestAvailableDate: p2.latestAvailableDate,
    },
    period1Label: p1Label,
    period2Label: p2Label,
    likeForLikeAligned: true,
    alignmentNote:
      p2ActualEnd < params.period2.endDate
        ? `Lưu ý: Dữ liệu chu kỳ 2 mới có đến ngày ${p2ActualEnd} (tổng cộng ${p2ActualDays} ngày). Hệ thống đã tự động căn chỉnh chu kỳ 1 về đúng cùng kỳ ${p1ActualDays} ngày (${p1ActualStart} -> ${p1ActualEnd}) để đảm bảo so sánh chuẩn xác (Like-for-Like / Apple-to-Apple).`
        : `So sánh cùng kỳ chuẩn xác (${p1ActualDays} ngày vs ${p2ActualDays} ngày).`,
    comparison: {
      revenue: calcDiff(t2.totalRevenue, t1.totalRevenue),
      unitsSold: calcDiff(t2.totalQuantity, t1.totalQuantity),
      adsFee: calcDiff(t2.totalAdsFee, t1.totalAdsFee),
      amazonFee: calcDiff(t2.totalAmazonFee, t1.totalAmazonFee),
      returnCost: calcDiff(t2.totalReturnCost, t1.totalReturnCost),
      profit: calcDiff(t2.totalProfit, t1.totalProfit),
      netProfit: calcDiff(t2.totalNetProfit, t1.totalNetProfit),
      marginPct: {
        period1: t1.avgMargin,
        period2: t2.avgMargin,
        diff: Number((t2.avgMargin - t1.avgMargin).toFixed(1)),
      },
    },
  };
}

/**
 * 5. Tra cứu Lô hàng đang đi (Inbound Shipments)
 */
export async function getInboundShipments(params: {
  storeQuery?: string;
  sku?: string;
  status?: "pending" | "received" | "all";
  limit?: number;
}) {
  const sql = await getDatabaseClient();
  const targetStore = params.storeQuery ? await resolveStore(params.storeQuery) : null;
  const storeId = targetStore ? targetStore.id : null;
  const skuQuery = params.sku?.trim() || null;
  const limit = Math.min(params.limit || 20, 100);

  const rows = await sql<Array<{
    id: string;
    store_id: string;
    ten_lo_hang: string | null;
    shipment_id: string | null;
    sku: string;
    quantity: number;
    line_ship: string | null;
    ngay_di: string | null;
    ngay_den: string | null;
    amazon_received: number | null;
  }>>`
    SELECT
      id,
      store_id,
      ten_lo_hang,
      shipment_id,
      sku,
      quantity,
      line_ship,
      ngay_di,
      ngay_den,
      amazon_received
    FROM accounting_inbound_shipments
    WHERE 1=1
      ${storeId ? sql`AND store_id = ${storeId}` : sql``}
      ${skuQuery ? sql`AND sku ILIKE ${"%" + skuQuery + "%"}` : sql``}
      ${
        params.status === "pending"
          ? sql`AND (amazon_received IS NULL OR amazon_received < quantity)`
          : params.status === "received"
          ? sql`AND amazon_received >= quantity`
          : sql``
      }
    ORDER BY ngay_di DESC NULLS LAST
    LIMIT ${limit}
  `;

  const stores = await getAllStores();
  const storeMap = new Map(stores.map((s) => [s.id, s.name]));
  const hasRecords = rows.length > 0;

  return {
    hasData: hasRecords,
    message: hasRecords
      ? undefined
      : `Không tìm thấy lô hàng nào đang vận chuyển ${targetStore ? `cho store ${targetStore.name}` : ""} ${skuQuery ? `với mã SKU "${skuQuery}"` : ""}.`,
    store: targetStore ? targetStore.name : "Tất cả các store",
    totalShipmentsFound: rows.length,
    shipments: rows.map((r) => {
      const received = r.amazon_received || 0;
      const total = r.quantity || 0;
      let statusStr = "Đang đi (Chưa nhận)";
      if (received >= total && total > 0) statusStr = "Đã nhận đủ";
      else if (received > 0) statusStr = `Đang nhận (${received}/${total})`;

      return {
        storeName: storeMap.get(r.store_id) || "Unknown",
        shipmentName: r.ten_lo_hang || "N/A",
        shipmentId: r.shipment_id || "N/A",
        sku: r.sku,
        quantity: total,
        amazonReceived: received,
        status: statusStr,
        shipDate: r.ngay_di || "N/A",
        estimatedArrival: r.ngay_den || "Chưa có ngày đến",
        carrierLine: r.line_ship || "N/A",
      };
    }),
  };
}

/**
 * Tra cứu hoặc khởi tạo store PPC theo tên
 */
export async function resolvePpcStore(storeQuery?: string): Promise<{ id: string; name: string; team_id: string } | null> {
  const sql = await getDatabaseClient();
  if (!storeQuery || !storeQuery.trim()) return null;
  const q = storeQuery.trim().toLowerCase();

  const ppcStores = await sql<Array<{ id: string; name: string; team_id: string }>>`
    SELECT id, name, team_id FROM ppc_stores
  `;

  let found = ppcStores.find(
    (s) =>
      s.id === storeQuery ||
      s.name.toLowerCase() === q ||
      s.name.toLowerCase().includes(q) ||
      q.includes(s.name.toLowerCase())
  );

  if (!found) {
    const accStore = await resolveStore(storeQuery);
    if (accStore) {
      const inserted = await sql<Array<{ id: string; name: string; team_id: string }>>`
        INSERT INTO ppc_stores (name, team_id, marketplace)
        VALUES (${accStore.name}, 'default', ${accStore.marketplace || 'US'})
        ON CONFLICT (team_id, name) DO UPDATE SET updated_at = NOW()
        RETURNING id, name, team_id
      `;
      if (inserted.length > 0) {
        found = inserted[0];
      }
    }
  }

  return found || null;
}

/**
 * 6. Tra cứu danh sách các từ khóa ĐANG phủ định trong hệ thống (Negative Registry / Hub)
 */
export async function listNegativeKeywords(params: {
  storeQuery?: string;
  search?: string;
  limit?: number;
}) {
  const sql = await getDatabaseClient();
  const limit = Math.min(50, Math.max(1, params.limit || 15));
  let store: { id: string; name: string } | null = null;
  if (params.storeQuery) {
    store = await resolvePpcStore(params.storeQuery);
  }

  const rows = await sql<Array<{
    id: string;
    store_name: string;
    campaign_name: string;
    ad_group_name: string | null;
    keyword_text: string;
    match_type: string;
    state: string;
    clicks: number;
    spend: number;
    created_at: string;
  }>>`
    SELECT 
      nr.id, nr.store_name, nr.campaign_name, nr.ad_group_name,
      nr.keyword_text, nr.match_type, nr.state, nr.clicks, nr.spend, nr.created_at
    FROM ppc_negative_registry nr
    WHERE 1=1
      ${store ? sql`AND nr.store_id = ${store.id}` : sql``}
      ${params.search ? sql`AND (LOWER(nr.keyword_text) LIKE ${"%" + params.search.toLowerCase() + "%"} OR LOWER(nr.campaign_name) LIKE ${"%" + params.search.toLowerCase() + "%"})` : sql``}
    ORDER BY nr.created_at DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    return {
      hasData: false,
      message: store 
        ? `Store ${store.name} hiện chưa có từ khóa nào trong danh sách Negative Registry.`
        : "Hệ thống hiện chưa có từ khóa nào trong danh sách Negative Registry.",
      totalFound: 0,
      items: [],
    };
  }

  return {
    hasData: true,
    storeName: store ? store.name : "Tất cả các store",
    totalFound: rows.length,
    instructions: "Hiển thị danh sách từ khóa dạng bảng hoặc danh sách đánh số STT rõ ràng (Store, Campaign, Keyword, Match Type, Clicks, Spend Saved).",
    items: rows.map((r, idx) => ({
      stt: idx + 1,
      store: r.store_name,
      campaign: r.campaign_name,
      adGroup: r.ad_group_name || "N/A",
      keyword: r.keyword_text,
      matchType: r.match_type,
      state: r.state,
      clicksPrevented: r.clicks,
      spendSaved: Number(r.spend || 0),
    })),
  };
}

/**
 * 7. Tra cứu danh sách các Search Terms lãng phí tiền (Clicks cao, 0 đơn) CẦN phủ định
 * Tự động lưu vào bộ nhớ phiên để người dùng có thể chỉ định theo số thứ tự (ví dụ: "phủ định từ số 1, 3")
 */
export async function listNegativeCandidates(
  params: {
    storeQuery?: string;
    minClicks?: number;
    limit?: number;
  },
  sessionId?: string
) {
  const sql = await getDatabaseClient();

  if (!params.storeQuery || !params.storeQuery.trim()) {
    const ppcStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores ORDER BY name ASC
    `;
    return {
      hasData: false,
      needsStoreClarification: true,
      message: `Vui lòng cho biết bạn muốn tra cứu từ khóa lãng phí (Negative) cho store nào? Hệ thống hiện có: ${ppcStores.map((s) => s.name).join(", ")}.`,
    };
  }

  const targetStore = await resolvePpcStore(params.storeQuery);
  if (!targetStore) {
    const ppcStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores ORDER BY name ASC
    `;
    return {
      hasData: false,
      message: `Không tìm thấy store "${params.storeQuery}". Hệ thống hiện có các store PPC: ${ppcStores.map((s) => s.name).join(", ")}.`,
    };
  }

  const limit = Math.min(30, Math.max(1, params.limit || 5));
  const minClicks = Math.max(1, params.minClicks || 10);

  const rows = await sql<Array<{
    store_id: string;
    store_name: string;
    campaign_name: string;
    campaign_id: string | null;
    ad_group_name: string | null;
    ad_group_id: string | null;
    ad_type: string | null;
    customer_search_term: string;
    clicks: number;
    spend: number;
  }>>`
    WITH daily_counts AS (
      SELECT store_id, ad_type, COUNT(*) as cnt
      FROM ppc_search_terms
      WHERE report_granularity = 'DAILY'
      GROUP BY store_id, ad_type
    ),
    latest_range AS (
      SELECT store_id, ad_type, MAX(report_end_date) as max_end_date
      FROM ppc_search_terms
      WHERE report_granularity = 'RANGE'
      GROUP BY store_id, ad_type
    ),
    raw_filtered AS (
      SELECT
        st.store_id,
        s.name AS store_name,
        st.campaign_id,
        st.campaign_name,
        st.ad_group_id,
        st.ad_group_name,
        st.customer_search_term,
        st.ad_type,
        st.clicks,
        st.spend,
        st.orders
      FROM ppc_search_terms st
      JOIN ppc_stores s ON s.id = st.store_id
      LEFT JOIN daily_counts dc ON dc.store_id = st.store_id AND dc.ad_type = st.ad_type
      LEFT JOIN latest_range lr ON lr.store_id = st.store_id AND lr.ad_type = st.ad_type
      WHERE st.store_id = ${targetStore.id}
        AND (
          (st.report_granularity = 'DAILY')
          OR
          (st.report_granularity = 'RANGE' AND (dc.cnt IS NULL OR dc.cnt = 0) AND st.report_end_date = lr.max_end_date)
        )
    )
    SELECT 
      rf.store_id,
      rf.store_name,
      rf.campaign_name,
      MIN(rf.campaign_id) as campaign_id,
      MIN(rf.ad_group_name) as ad_group_name,
      MIN(rf.ad_group_id) as ad_group_id,
      MIN(rf.ad_type) as ad_type,
      rf.customer_search_term,
      SUM(rf.clicks)::integer as clicks,
      ROUND(SUM(rf.spend)::numeric, 2)::float as spend
    FROM raw_filtered rf
    WHERE NOT EXISTS (
      SELECT 1 FROM ppc_negative_registry nr
      WHERE nr.store_id = rf.store_id
        AND LOWER(TRIM(nr.campaign_name)) = LOWER(TRIM(rf.campaign_name))
        AND LOWER(TRIM(nr.keyword_text)) = LOWER(TRIM(rf.customer_search_term))
        AND nr.state = 'enabled'
    )
    AND NOT EXISTS (
      SELECT 1 FROM ppc_performance_facts pf
      WHERE pf.store_id = rf.store_id
        AND pf.grain = 'TARGET'
        AND pf.is_negative = true
        AND LOWER(TRIM(pf.target_expression)) = LOWER(TRIM(rf.customer_search_term))
    )
    GROUP BY rf.store_id, rf.store_name, rf.campaign_name, rf.customer_search_term
    HAVING SUM(rf.orders) = 0 AND SUM(rf.clicks) >= ${minClicks}
    ORDER BY clicks DESC, spend DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    return {
      hasData: false,
      message: `Không tìm thấy search term nào lãng phí (>= ${minClicks} clicks, 0 đơn) cho store ${targetStore.name}.`,
      items: [],
    };
  }

  const items: PendingNegativeItem[] = rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    keyword: r.customer_search_term,
    campaignName: r.campaign_name,
    campaignId: r.campaign_id || undefined,
    adGroupName: r.ad_group_name || undefined,
    adGroupId: r.ad_group_id || undefined,
    clicks: Number(r.clicks || 0),
    spend: Number(r.spend || 0),
    matchType: "negativeExact",
  }));

  if (sessionId) {
    await setLastListedCandidates(sessionId, items);
  }

  return {
    hasData: true,
    storeName: targetStore.name,
    totalCandidates: rows.length,
    instructions: "Trình bày danh sách dạng đánh số gọn gàng (STT. **Search Term** (Store) / Clicks: N | Lãng phí: $X (0 đơn) / Campaign: ...). TUYỆT ĐỐI KHÔNG dùng bảng ngang nhiều cột vì tên Campaign dài làm tràn vỡ giao diện chat. Hướng dẫn người dùng có thể nhắn số thứ tự (ví dụ: 'phủ định từ số 1, 2') hoặc nhắn trực tiếp các từ khóa để yêu cầu phủ định.",
    candidates: rows.map((r, idx) => ({
      stt: idx + 1,
      store: r.store_name,
      keyword: r.customer_search_term,
      campaign: r.campaign_name,
      adGroup: r.ad_group_name || "N/A",
      clicks: Number(r.clicks || 0),
      spend: Number(r.spend || 0),
    })),
  };
}

/**
 * 8. Khởi tạo yêu cầu Phủ định Từ khóa (Hỗ trợ 1 hoặc NHIỀU từ khóa, hoặc chọn theo STT)
 * BẮT BUỘC: Thao tác này KHÔNG đẩy trực tiếp vào DB ngay, mà tạo trạng thái chờ xác nhận.
 */
export async function requestNegativeKeywordAction(
  params: {
    storeQuery?: string;
    keyword?: string;
    keywords?: string[];
    itemIndices?: number[];
    matchType?: string;
    campaignName?: string;
    reason?: string;
  },
  sessionId?: string
) {
  let store = params.storeQuery ? await resolvePpcStore(params.storeQuery) : null;
  if (!store && sessionId) {
    const cachedCandidates = await getLastListedCandidates(sessionId);
    if (cachedCandidates.length > 0 && cachedCandidates[0].storeId && cachedCandidates[0].storeName) {
      store = { id: cachedCandidates[0].storeId, name: cachedCandidates[0].storeName, team_id: "default" };
    }
  }

  if (!store) {
    const sql = await getDatabaseClient();
    const ppcStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores ORDER BY name ASC
    `;
    return {
      status: "ERROR",
      message: `Vui lòng chỉ định rõ tên Store (Hệ thống có: ${ppcStores.map((s) => s.name).join(", ")}).`,
    };
  }

  const effectiveStore = store;
  const sql = await getDatabaseClient();
  const matchType = params.matchType === "negativePhrase" ? "negativePhrase" : "negativeExact";
  const defaultReason = params.reason?.trim() || "Tối ưu hóa PPC - Lãng phí clicks không ra đơn";

  // Thu thập danh sách từ khóa cần xử lý
  let itemsToNegate: PendingNegativeItem[] = [];

  // Trường hợp 1: Người dùng chọn theo số thứ tự (STT) từ danh sách vừa tra cứu
  if (params.itemIndices && params.itemIndices.length > 0 && sessionId) {
    const cached = await getLastListedCandidates(sessionId);
    for (const idx of params.itemIndices) {
      const found = cached[idx - 1];
      if (found) {
        itemsToNegate.push({
          ...found,
          matchType,
          reason: defaultReason,
        });
      }
    }
  }

  // Trường hợp 2: Danh sách tên từ khóa được truyền vào (array hoặc single string)
  const rawKeywords: string[] = [];
  if (Array.isArray(params.keywords)) {
    rawKeywords.push(...params.keywords);
  }
  if (params.keyword && !rawKeywords.includes(params.keyword)) {
    rawKeywords.push(params.keyword);
  }

  if (rawKeywords.length > 0) {
    // Tra cứu thông tin campaign từ database cho từng từ khóa
    for (const kw of rawKeywords) {
      const clean = kw.trim();
      if (!clean) continue;

      // Tìm trong ppc_search_terms để lấy đúng campaign và ad group
      const stRow = await sql<Array<{
        campaign_name: string;
        campaign_id: string | null;
        ad_group_name: string | null;
        ad_group_id: string | null;
        ad_type: string | null;
        clicks: number;
        spend: number;
      }>>`
        SELECT campaign_name, campaign_id, ad_group_name, ad_group_id, ad_type, clicks, spend
        FROM ppc_search_terms
        WHERE store_id = ${effectiveStore.id}
          AND LOWER(customer_search_term) = LOWER(${clean})
        ORDER BY clicks DESC
        LIMIT 1
      `;

      if (stRow.length > 0) {
        itemsToNegate.push({
          keyword: clean,
          campaignName: stRow[0].campaign_name,
          campaignId: stRow[0].campaign_id || undefined,
          adGroupName: stRow[0].ad_group_name || undefined,
          adGroupId: stRow[0].ad_group_id || undefined,
          adType: stRow[0].ad_type || "SP",
          clicks: Number(stRow[0].clicks || 0),
          spend: Number(stRow[0].spend || 0),
          matchType,
          reason: defaultReason,
        });
      } else {
        itemsToNegate.push({
          keyword: clean,
          campaignName: params.campaignName?.trim() || `${effectiveStore.name} - Auto All Campaigns`,
          matchType,
          reason: defaultReason,
        });
      }
    }
  }

  // Loại bỏ các từ khóa trùng lặp
  const uniqueMap = new Map<string, PendingNegativeItem>();
  for (const it of itemsToNegate) {
    const key = `${it.campaignName.toLowerCase()}|||${it.keyword.toLowerCase()}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, it);
  }
  const finalItems = Array.from(uniqueMap.values());

  if (finalItems.length === 0) {
    return {
      status: "ERROR",
      message: "Không tìm thấy từ khóa hợp lệ nào để phủ định. Vui lòng cung cấp tên từ khóa hoặc số thứ tự từ danh sách.",
    };
  }

  const pendingAction: PendingPpcAction = {
    action: "NEGATIVE_KEYWORD",
    storeId: effectiveStore.id,
    storeName: effectiveStore.name,
    campaignName: finalItems[0]?.campaignName || `${effectiveStore.name} - Auto All Campaigns`,
    keyword: finalItems[0]?.keyword || "",
    matchType,
    reason: defaultReason,
    items: finalItems,
    createdAt: Date.now(),
  };

  if (sessionId) {
    await setPendingAction(sessionId, pendingAction);
  }

  return {
    status: "AWAITING_CONFIRMATION",
    requiresConfirmation: true,
    storeName: effectiveStore.name,
    storeId: effectiveStore.id,
    totalCount: finalItems.length,
    matchType,
    items: finalItems.map((it, idx) => ({
      stt: idx + 1,
      keyword: it.keyword,
      campaign: it.campaignName,
      adGroup: it.adGroupName || "All",
      clicks: it.clicks || 0,
      spend: it.spend || 0,
    })),
    instructionForAgent: `BẮT BUỘC: Thao tác CHƯA được thực thi. Hãy hiển thị Thẻ Xác Nhận ĐƠN GIẢN, DỄ NHÌN với thông tin:
- Store: ${effectiveStore.name}
- Số lượng: ${finalItems.length} từ khóa
- Liệt kê danh sách từng từ khóa kèm Campaign tương ứng.
- Hỏi người dùng có xác nhận auto đẩy lên hệ thống PPC (tạo Bulksheet & lưu vào Hub) không.
- Hướng dẫn người dùng nhấn nút 'Xác nhận đẩy ngay' hoặc nhắn 'Xác nhận' để thực thi, hoặc 'Hủy' để bỏ qua.`,
  };
}

/**
 * 9. Thực thi Auto Upload từ khóa vào bảng Phủ định & Xuất Bulksheet đẩy lên Seller Central
 */
export async function executeConfirmNegativeKeyword(action: PendingPpcAction) {
  const sql = await getDatabaseClient();
  const storeId = action.storeId;
  const storeName = action.storeName;
  const items: PendingNegativeItem[] = action.items && action.items.length > 0 
    ? action.items 
    : [{
        keyword: action.keyword || "",
        campaignName: action.campaignName || `${storeName} - Auto All Campaigns`,
        matchType: action.matchType || "negativeExact",
      }];

  const validItems = items.filter(it => Boolean(it.keyword?.trim()));
  if (validItems.length === 0) {
    throw new Error("Không có từ khóa hợp lệ để auto upload.");
  }

  // 1. Tra cứu thêm campaign_id, ad_group_id nếu thiếu
  const missingCampaignNames = [
    ...new Set(
      validItems
        .filter((it) => !it.campaignId || !it.adGroupId)
        .map((it) => it.campaignName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const campaignIdLookup = new Map<string, string>();
  const campaignAdTypeLookup = new Map<string, string>();
  const campaignDefaultAgId = new Map<string, string>();
  const adGroupIdLookup = new Map<string, string>();

  if (missingCampaignNames.length > 0) {
    const facts = await sql<Array<{
      campaign_name: string;
      campaign_id: string;
      ad_type: string;
      ad_group_name: string;
      ad_group_id: string;
    }>>`
      SELECT DISTINCT campaign_name, campaign_id, ad_type, ad_group_name, ad_group_id
      FROM ppc_performance_facts
      WHERE store_id = ${storeId}
        AND campaign_name = ANY(${missingCampaignNames})
        AND campaign_id IS NOT NULL
        AND length(campaign_id) > 0
    `;

    for (const f of facts) {
      const campKey = (f.campaign_name || "").trim().toLowerCase();
      if (campKey && f.campaign_id && !campaignIdLookup.has(campKey)) {
        campaignIdLookup.set(campKey, f.campaign_id);
      }
      if (campKey && f.ad_type && !campaignAdTypeLookup.has(campKey)) {
        campaignAdTypeLookup.set(campKey, f.ad_type);
      }
      if (campKey && f.ad_group_id && !campaignDefaultAgId.has(campKey)) {
        campaignDefaultAgId.set(campKey, f.ad_group_id);
      }
      const agKey = `${campKey}|||${(f.ad_group_name || "").trim().toLowerCase()}`;
      if (campKey && f.ad_group_id && !adGroupIdLookup.has(agKey)) {
        adGroupIdLookup.set(agKey, f.ad_group_id);
      }
    }
  }

  // 2. Chuẩn hóa thành PpcRecommendation
  const recommendations: PpcRecommendation[] = validItems.map((it, idx) => {
    const campName = (it.campaignName || "").trim();
    const agName = (it.adGroupName || campName).trim();
    const campKey = campName.toLowerCase();
    const agKey = `${campKey}|||${agName.toLowerCase()}`;

    const resolvedCampId = it.campaignId || campaignIdLookup.get(campKey) || "";
    const resolvedAgId = it.adGroupId || adGroupIdLookup.get(agKey) || campaignDefaultAgId.get(campKey) || "";
    const resolvedAdType = it.adType || campaignAdTypeLookup.get(campKey) || "SP";

    const term = it.keyword.trim();
    const isProduct =
      term.toLowerCase().startsWith("b0") ||
      term.toLowerCase().startsWith("asin=") ||
      term.toLowerCase().startsWith("category=");

    return {
      id: `st-lark-neg-${idx}-${Date.now()}`,
      storeId,
      storeName,
      adType: (resolvedAdType as any) || "SP",
      recType: "NEGATIVE_KEYWORD",
      targetType: isProduct ? "PRODUCT" : "EXACT",
      keyword: term,
      campaignName: campName,
      adGroupName: agName,
      campaignId: resolvedCampId,
      adGroupId: resolvedAgId,
      matchType: "Exact",
      priority: "P0",
      reason: action.reason || `Lark Bot Auto Negative: Phủ định Negative Exact trong ${campName}`,
      estimatedSavings: Number(it.spend || 0),
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
  });

  const jobId = crypto.randomUUID();
  let fileName = "";
  let bulksheetCreated = false;

  // 3. Xuất file Excel chuẩn Amazon Bulksheet & Upload R2 nếu có campaignId và driver = r2
  try {
    const canExportBulksheet = recommendations.every(r => Boolean(r.campaignId)) && objectStorageDriver() === "r2";
    if (canExportBulksheet) {
      const buffer = await exportBulksheetUpdateExcel(recommendations);
      const cleanStore = storeName
        .replace(/[/\\?%*:|"<>]/g, "_")
        .trim()
        .replace(/\s+/g, "_");
      
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const val = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
      const tsStr = `${val("year")}${val("month")}${val("day")}_${val("hour")}${val("minute")}${val("second")}`;
      fileName = `Upload_${cleanStore}_ST_NegativeExact_${recommendations.length}Terms_${tsStr}.xlsx`;

      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const safeStore = storeName.replace(/[^A-Za-z0-9._-]+/g, "-");
      const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${fileName}`;

      await putStoredObject({
        key: r2Key,
        bytes: buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256,
        metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
      });

      const distinctCamps = Array.from(new Set(validItems.map((c) => c.campaignName))).slice(0, 50);
      const actionsPayload = recommendations.map((rec) => ({
        id: rec.id,
        sku: "ST_NEGATIVE",
        campaignName: rec.campaignName,
        adGroupName: rec.adGroupName || "",
        targetKeyword: rec.keyword,
        matchType: rec.matchType || "Negative Exact",
        actionType: "NEGATIVE_KEYWORD",
        oldValue: null,
        finalValue: null,
        status: "PENDING",
        reason: rec.reason,
        estimatedSavings: rec.estimatedSavings,
      }));

      // Ghi nhận tác vụ vào ppc_auto_upload_logs để Mac mini worker pick up
      await sql`
        INSERT INTO ppc_auto_upload_logs (
          id, team_id, store_id, file_name, action_count, skus, status, stage,
          file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
        ) VALUES (
          ${jobId}, 'default', ${storeId}, ${fileName}, ${recommendations.length},
          ${sql.json(distinctCamps)}, 'PENDING', 'FILE_READY',
          'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), 'Lark Bot AI'
        )
      `;
      bulksheetCreated = true;
    }
  } catch (bulkErr) {
    console.warn("[LarkTools] Không thể xuất file bulksheet R2, ghi trực tiếp vào registry:", bulkErr);
  }

  // 4. Đăng ký các từ khóa vào bảng ppc_negative_registry (Negative Hub)
  for (const item of validItems) {
    const matchType = item.matchType || action.matchType || "negativeExact";
    const campName = item.campaignName || action.campaignName || `${storeName} - Auto All Campaigns`;
    await sql`
      INSERT INTO ppc_negative_registry (
        team_id, store_id, store_name, ad_type,
        campaign_id, campaign_name, ad_group_id, ad_group_name,
        keyword_text, match_type, level,
        state, source, source_job_id, clicks, spend, reason, created_at, updated_at
      ) VALUES (
        'default', ${storeId}, ${storeName}, ${item.adType || 'SP'},
        ${item.campaignId || null}, ${campName}, ${item.adGroupId || null}, ${item.adGroupName || null},
        ${item.keyword}, ${matchType}, ${item.adGroupId ? 'AD_GROUP' : 'CAMPAIGN'},
        'enabled', 'AUTO_UPLOAD', ${jobId}, ${item.clicks || 0}, ${item.spend || 0},
        ${action.reason || 'Auto Negative qua Lark Bot AI'}, NOW(), NOW()
      )
      ON CONFLICT (store_id, campaign_name, keyword_text, match_type) DO UPDATE SET
        updated_at = NOW(),
        state = 'enabled',
        source_job_id = EXCLUDED.source_job_id,
        reason = EXCLUDED.reason;
    `;
  }

  await invalidateCachePattern("ppc:query:st-opt:*").catch(() => {});

  return {
    success: true,
    storeName,
    jobId: bulksheetCreated ? jobId : undefined,
    fileName: bulksheetCreated ? fileName : undefined,
    bulksheetCreated,
    count: validItems.length,
    keywords: validItems.map(i => i.keyword),
  };
}

/**
 * 8. Tra cứu các Search Terms ra đơn tốt (Sale KW Candidates) để chuẩn bị lên camp
 */
export async function listSaleKwCandidates(
  params: {
    storeQuery?: string;
    sku?: string;
    minOrders?: number;
    daysWindow?: number;
    limit?: number;
  },
  sessionId?: string
) {
  const sql = await getDatabaseClient();

  if (!params.storeQuery || !params.storeQuery.trim()) {
    const ppcStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores ORDER BY name ASC
    `;
    return {
      hasData: false,
      needsStoreClarification: true,
      message: `Vui lòng cho biết bạn muốn tra cứu từ khóa Sale KW cho store nào? Hệ thống hiện có: ${ppcStores.map((s) => s.name).join(", ")}.`,
    };
  }

  const targetStore = await resolvePpcStore(params.storeQuery);
  if (!targetStore) {
    const ppcStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores ORDER BY name ASC
    `;
    return {
      hasData: false,
      store: params.storeQuery,
      error: `Không tìm thấy store "${params.storeQuery}". Hệ thống hiện có các store PPC: ${ppcStores.map((s) => s.name).join(", ")}.`,
    };
  }

  const storeId = targetStore.id;
  const storeName = targetStore.name;
  const daysWindow = [7, 14, 30, 60, 90].includes(Number(params.daysWindow)) ? Number(params.daysWindow) : 30;
  // Chuẩn hóa theo mặc định của web UI: Orders > 2 (tức >= 3 đơn trong cửa sổ 30 ngày)
  const minOrders = params.minOrders !== undefined ? Math.max(1, Number(params.minOrders)) : 3;
  const limit = Math.min(30, Math.max(1, Number(params.limit || 10)));
  const filterSku = params.sku && params.sku !== "ALL" ? params.sku.trim().toUpperCase() : null;

  // Query từ bảng tổng hợp ppc_sale_kw_summary theo đúng khung thời gian days_window
  const candidates = await sql<Array<{
    store_id: string;
    store_name: string;
    sku: string;
    customer_search_term: string;
    orders: number;
    clicks: number;
    spend: string | number;
    sales: string | number;
    source_campaign_id: string;
    source_campaign_name: string;
    source_ad_group_id: string;
    source_ad_group_name: string;
    is_already_launched: boolean;
    total_available: number;
  }>>`
    WITH raw_cands AS (
      SELECT
        s.store_id,
        st.name AS store_name,
        upper(s.sku) AS sku,
        s.customer_search_term,
        s.orders,
        s.clicks,
        s.spend,
        s.sales,
        s.source_campaign_id,
        s.source_campaign_name,
        s.source_ad_group_id,
        s.source_ad_group_name,
        (EXISTS (
          SELECT 1 FROM ppc_sale_kw_registry sr
          WHERE sr.store_id = s.store_id
            AND sr.state IN ('pending', 'enabled')
            AND lower(trim(sr.keyword_text)) = lower(trim(s.customer_search_term))
            AND (
              sr.sku IS NULL
              OR lower(trim(sr.sku)) = lower(trim(s.sku))
              OR substring(sr.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)') = substring(s.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)')
            )
          LIMIT 1
        )) AS is_already_launched
      FROM ppc_sale_kw_summary s
      JOIN ppc_stores st ON st.id = s.store_id
      WHERE s.store_id = ${storeId}
        AND s.days_window = ${daysWindow}
        ${filterSku ? sql`AND upper(s.sku) = ${filterSku}` : sql``}
        AND s.orders >= ${minOrders}
    )
    SELECT *,
      COUNT(*) OVER()::integer AS total_available
    FROM raw_cands
    WHERE NOT is_already_launched
    ORDER BY orders DESC, sales DESC
    LIMIT ${limit}
  `;

  if (candidates.length === 0) {
    return {
      hasData: false,
      storeName,
      message: `Không tìm thấy search term nào có từ ${minOrders} đơn trở lên trong ${daysWindow} ngày qua${filterSku ? ` cho SKU ${filterSku}` : ""} chưa lên camp cho store ${storeName}.`,
    };
  }

  // Lọc bỏ ASIN nếu có
  const validCandidates = candidates.filter((c) => !isAsinProductTarget(c.customer_search_term));

  const memoryItems: PendingSaleKwItem[] = validCandidates.map((c) => {
    const spend = Number(c.spend || 0);
    const clicks = Number(c.clicks || 0);
    const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0.8;
    return {
      storeId: targetStore.id,
      storeName: targetStore.name,
      keyword: c.customer_search_term,
      sku: c.sku,
      orders: Number(c.orders || 0),
      clicks,
      spend,
      sales: Number(c.sales || 0),
      cpc,
      bid: cpc,
      sourceCampaignName: c.source_campaign_name,
      sourceCampaignId: c.source_campaign_id,
      sourceAdGroupId: c.source_ad_group_id,
      sourceAdGroupName: c.source_ad_group_name,
    };
  });

  if (sessionId) {
    await setLastSaleKwCandidates(sessionId, memoryItems);
  }

  const formattedItems = memoryItems.map((item, idx) => {
    const acos = item.sales > 0 ? Number(((item.spend / item.sales) * 100).toFixed(1)) : 0;
    return {
      index: idx + 1,
      keyword: item.keyword,
      sku: item.sku,
      orders: item.orders,
      sales: `$${Number(item.sales).toFixed(2)}`,
      spend: `$${Number(item.spend).toFixed(2)}`,
      clicks: item.clicks,
      cpc: `$${item.cpc?.toFixed(2)}`,
      acos: `${acos}%`,
      sourceCampaign: item.sourceCampaignName,
    };
  });

  const totalAvailable = Number(candidates[0]?.total_available || formattedItems.length);

  return {
    hasData: true,
    storeName,
    daysWindow,
    totalAvailableInStore: totalAvailable,
    showingCount: formattedItems.length,
    items: formattedItems,
    guide: `Tìm thấy ${totalAvailable} từ khóa tiềm năng (Orders > 2 trong ${daysWindow} ngày qua) cho store ${storeName}. Đang hiển thị ${formattedItems.length} từ khóa ra đơn tốt nhất. Người dùng có thể chọn số thứ tự (ví dụ: 'Lên camp số 1, 2' hoặc 'Lên camp tất cả ${formattedItems.length} từ này') để bot tạo bộ 3 Campaign (Exact, Phrase, Broad) và hiển thị Thẻ Xác Nhận.`,
  };
}

/**
 * 9. Khởi tạo yêu cầu tạo bộ 3 Campaign Sale KW (Exact, Phrase, Broad)
 */
export async function requestLaunchSaleKwAction(
  params: {
    storeQuery?: string;
    itemIndices?: number[];
    keywords?: string[];
    sku?: string;
    dailyBudget?: number;
    defaultBid?: number;
    userName?: string;
    negateInSource?: boolean;
  },
  sessionId?: string
) {
  let store = params.storeQuery ? await resolvePpcStore(params.storeQuery) : null;
  if (!store && sessionId) {
    const lastCandidates = await getLastSaleKwCandidates(sessionId);
    if (lastCandidates.length > 0 && lastCandidates[0].storeId && lastCandidates[0].storeName) {
      store = { id: lastCandidates[0].storeId, name: lastCandidates[0].storeName, team_id: "default" };
    }
  }

  if (!store) {
    const sql = await getDatabaseClient();
    const ppcStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores ORDER BY name ASC
    `;
    return {
      hasData: false,
      needsStoreClarification: true,
      error: `Vui lòng chỉ định rõ store bạn muốn lên camp (${ppcStores.map((s) => s.name).join(", ")}).`,
    };
  }

  let selectedItems: PendingSaleKwItem[] = [];

  // 1. Nếu chọn theo số thứ tự (STT) từ danh sách vừa tra cứu
  if (sessionId && Array.isArray(params.itemIndices) && params.itemIndices.length > 0) {
    const lastCandidates = await getLastSaleKwCandidates(sessionId);
    if (lastCandidates.length > 0) {
      for (const idx of params.itemIndices) {
        const item = lastCandidates[idx - 1];
        if (item) selectedItems.push(item);
      }
    }
  }

  // 2. Nếu truyền danh sách keywords trực tiếp
  if (selectedItems.length === 0 && Array.isArray(params.keywords) && params.keywords.length > 0) {
    const defaultSku = (params.sku || "GENERAL").trim().toUpperCase();
    selectedItems = params.keywords.map((kw) => ({
      keyword: kw.trim(),
      sku: defaultSku,
      orders: 1,
      clicks: 1,
      spend: 1,
      sales: 20,
      cpc: params.defaultBid || 1.0,
      bid: params.defaultBid || 1.0,
    }));
  }

  if (selectedItems.length === 0) {
    return {
      hasData: false,
      error: "Không tìm thấy từ khóa nào để lên campaign. Vui lòng tra cứu trước hoặc cung cấp tên từ khóa cụ thể.",
    };
  }

  // 3. Chuẩn bị thông tin bộ 3 campaign triad
  const activeUser = (params.userName || "Loan").trim();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const val = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  const dateStr = `${val("year")}${val("month")}${val("day")}`;

  const defaultDailyBudget = Number(params.dailyBudget) || 5.0;
  const defaultBidVal = Number(params.defaultBid) || 1.0;

  // Nhóm theo SKU
  const skuGroups = new Map<string, PendingSaleKwItem[]>();
  for (const item of selectedItems) {
    const itemSku = (params.sku || item.sku || "GENERAL").trim().toUpperCase();
    if (!skuGroups.has(itemSku)) skuGroups.set(itemSku, []);
    skuGroups.get(itemSku)!.push(item);
  }

  const campaignTriads: Array<{ sku: string; exact: string; phrase: string; broad: string; keywordsCount: number }> = [];
  for (const [sku, items] of skuGroups.entries()) {
    const triad = generateSaleKwCampaignTriad({
      sku,
      adTypeCode: "SP03",
      userName: activeUser,
      dateStr,
    });
    campaignTriads.push({
      sku,
      exact: triad.exact,
      phrase: triad.phrase,
      broad: triad.broad,
      keywordsCount: items.length,
    });
  }

  // 4. Lưu trạng thái pending action
  const pendingAction: PendingPpcAction = {
    action: "LAUNCH_SALE_KW",
    storeId: store.id,
    storeName: store.name,
    saleKwItems: selectedItems,
    campaignTriads,
    dailyBudget: defaultDailyBudget,
    defaultBid: defaultBidVal,
    userName: activeUser,
    dateStr,
    negateInSource: Boolean(params.negateInSource),
    createdAt: Date.now(),
  };

  if (sessionId) {
    await setPendingAction(sessionId, pendingAction);
  }

  return {
    hasData: true,
    actionRequired: "CONFIRM_SALE_KW_LAUNCH",
    storeName: store.name,
    totalKeywords: selectedItems.length,
    totalCampaigns: campaignTriads.length * 3,
    dailyBudget: defaultDailyBudget,
    defaultBid: defaultBidVal,
    triads: campaignTriads,
    keywords: selectedItems.map((k) => ({
      keyword: k.keyword,
      sku: k.sku,
      orders: k.orders,
      sales: `$${Math.round(k.sales)}`,
      suggestedBid: `$${(k.bid || k.cpc || defaultBidVal).toFixed(2)}`,
    })),
    guide: "Hiển thị Thẻ Xác Nhận Lên Camp với nút bấm 'Xác nhận lên camp' hoặc hướng dẫn người dùng gõ 'Xác nhận' để tiến hành xuất bulksheet và đẩy lên Amazon.",
  };
}

/**
 * 10. Thực thi tạo file Bulksheet Sale KW và gửi lên R2 cho Mac mini worker upload
 */
export async function executeConfirmSaleKwLaunch(action: PendingPpcAction) {
  const sql = await getDatabaseClient();
  const storeId = action.storeId;
  const storeName = action.storeName;
  const items = action.saleKwItems || [];

  if (items.length === 0) {
    throw new Error("Không có từ khóa Sale KW nào để lên camp.");
  }

  const defaultDailyBudget = action.dailyBudget || 5.0;
  const defaultBidVal = action.defaultBid || 1.0;
  const activeUser = action.userName || "Loan";
  const dateStr = action.dateStr || normalizeSaleKwDate(new Date().toISOString().slice(0, 10));

  // 1. Nhóm theo SKU và sinh campaignsPayload
  const skuMap = new Map<string, PendingSaleKwItem[]>();
  for (const item of items) {
    const sku = (item.sku || "GENERAL").trim().toUpperCase();
    if (!skuMap.has(sku)) skuMap.set(sku, []);
    skuMap.get(sku)!.push(item);
  }

  const campaignsPayload: SaleKwCampaignPayload[] = [];
  for (const [sku, skuItems] of skuMap.entries()) {
    const triad = generateSaleKwCampaignTriad({
      sku,
      adTypeCode: "SP03",
      userName: activeUser,
      dateStr,
    });

    const totalSpend = skuItems.reduce((s, it) => s + (it.spend || 0), 0);
    const totalClicks = skuItems.reduce((s, it) => s + (it.clicks || 0), 0);
    const avgCpc = totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : defaultBidVal;

    const configs: Array<{ matchTypeLower: "exact" | "phrase" | "broad"; campName: string }> = [
      { matchTypeLower: "exact", campName: triad.exact },
      { matchTypeLower: "phrase", campName: triad.phrase },
      { matchTypeLower: "broad", campName: triad.broad },
    ];

    for (const cfg of configs) {
      campaignsPayload.push({
        sourceCampaignName: skuItems[0]?.sourceCampaignName || `${storeName} - Source`,
        sourceCampaignId: skuItems[0]?.sourceCampaignId,
        sourceAdGroupId: skuItems[0]?.sourceAdGroupId,
        sourceAdGroupName: skuItems[0]?.sourceAdGroupName,
        targetCampaignName: cfg.campName,
        adGroupName: sku,
        sku,
        skus: [sku],
        dailyBudget: defaultDailyBudget,
        defaultBid: defaultBidVal,
        biddingStrategy: "Dynamic bids - down only",
        negateInSource: Boolean(action.negateInSource),
        keywords: skuItems.map((it) => ({
          customerSearchTerm: it.keyword,
          keyword: it.keyword,
          matchType: cfg.matchTypeLower === "exact" ? "Exact" : (cfg.matchTypeLower === "phrase" ? "Phrase" : "Broad"),
          bid: avgCpc > 0 ? avgCpc : defaultBidVal,
          orders: it.orders,
          sales: it.sales,
          clicks: it.clicks,
          spend: it.spend,
        })),
      });
    }
  }

  // 2. Xuất file Bulksheet Excel và Upload R2
  const jobId = crypto.randomUUID();
  const buffer = await exportSaleKwBulksheetExcel(campaignsPayload);
  const cleanStore = storeName.replace(/[/\\?%*:|"<>]/g, "_").trim().replace(/\s+/g, "_");
  const fileName = `Upload_${cleanStore}_SaleKW_${campaignsPayload.length}Camps_${dateStr}_${Date.now().toString().slice(-6)}.xlsx`;
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const safeStore = storeName.replace(/[^A-Za-z0-9._-]+/g, "-");
  const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${fileName}`;

  await putStoredObject({
    key: r2Key,
    bytes: buffer,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sha256,
    metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
  });

  // 3. Ghi log vào ppc_auto_upload_logs để Mac mini worker pick up
  const distinctSkus = Array.from(skuMap.keys());
  const distinctCamps = campaignsPayload.map((c) => c.targetCampaignName);
  const actionsPayload = campaignsPayload.flatMap((camp) =>
    camp.keywords.map((kw, idx) => ({
      id: `sale-kw-${jobId.slice(0, 8)}-${idx}`,
      sku: camp.sku,
      campaignName: camp.targetCampaignName,
      adGroupName: camp.adGroupName || camp.sku || "",
      targetKeyword: kw.customerSearchTerm,
      matchType: kw.matchType || "Exact",
      actionType: "CREATE_CAMPAIGN",
      oldValue: null,
      finalValue: kw.bid || defaultBidVal,
      status: "PENDING",
      reason: `Lark Bot AI Auto Launch Sale KW: ${kw.customerSearchTerm} (${kw.orders || 1} orders)`,
      estimatedSavings: 0,
    }))
  );

  await sql`
    INSERT INTO ppc_auto_upload_logs (
      id, team_id, store_id, file_name, action_count, skus, status, stage,
      file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
    ) VALUES (
      ${jobId}, 'default', ${storeId}, ${fileName}, ${distinctCamps.length},
      ${sql.json(distinctSkus)}, 'PENDING', 'FILE_READY',
      'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), 'Lark Bot AI'
    )
  `;

  // 4. Đăng ký các từ khóa vào ppc_sale_kw_registry
  for (const camp of campaignsPayload) {
    for (const kw of camp.keywords) {
      await sql`
        INSERT INTO ppc_sale_kw_registry (
          team_id, store_id, store_name,
          source_campaign_id, source_campaign_name,
          target_campaign_name, ad_group_name,
          keyword_text, match_type, target_type,
          sku, bid, daily_budget,
          orders, sales, clicks, spend, cpc,
          state, source, source_job_id, created_at, updated_at
        ) VALUES (
          'default', ${storeId}, ${storeName},
          ${camp.sourceCampaignId || null}, ${camp.sourceCampaignName || null},
          ${camp.targetCampaignName}, ${camp.adGroupName || camp.sku || null},
          ${kw.customerSearchTerm}, ${kw.matchType || 'Exact'}, 'KEYWORD',
          ${camp.sku || null}, ${kw.bid || defaultBidVal}, ${defaultDailyBudget},
          ${kw.orders || 1}, ${kw.sales || 0}, ${kw.clicks || 0}, ${kw.spend || 0}, ${kw.bid || defaultBidVal},
          'pending', 'AUTO_UPLOAD', ${jobId}, NOW(), NOW()
        )
        ON CONFLICT (store_id, target_campaign_name, keyword_text, match_type) DO UPDATE SET
          updated_at = NOW(),
          state = 'pending',
          source_job_id = EXCLUDED.source_job_id;
      `;
    }
  }

  await invalidateCachePattern("ppc:query:sale-kw:*").catch(() => {});

  return {
    success: true,
    storeName,
    jobId,
    fileName,
    campaignsCount: campaignsPayload.length,
    keywordsCount: items.length,
    skus: distinctSkus,
  };
}


