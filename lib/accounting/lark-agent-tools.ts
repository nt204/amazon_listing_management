import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { listStores } from "./accounting-db";
import { listFbaDaily } from "./fba-daily-db";

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

  // Nếu là 1 store, dùng listFbaDaily để tính toán chuẩn nhất
  if (targetStore) {
    const res = await listFbaDaily(targetStore.id, {
      startDate: params.startDate,
      endDate: params.endDate,
      limit: 100,
      sortDirection: "asc",
    });

    const hasRecords = res.items.length > 0;
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
      period: { startDate: params.startDate, endDate: params.endDate },
      totalDays: res.stats.totalDays,
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
      });
      return {
        storeName: st.name,
        stats: res.stats,
      };
    })
  );

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

  return {
    scope: "Tất cả các store",
    period: { startDate: params.startDate, endDate: params.endDate },
    storeBreakdown: storeReports.map((r) => ({
      store: r.storeName,
      revenue: Math.round(r.stats.totalRevenue),
      quantity: r.stats.totalQuantity,
      adsFee: Math.round(r.stats.totalAdsFee),
      returnCost: Math.round(r.stats.totalReturnCost),
      profit: Math.round(r.stats.totalProfit),
      margin: r.stats.totalRevenue > 0 ? Number(((r.stats.totalProfit / r.stats.totalRevenue) * 100).toFixed(1)) : 0,
    })),
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
 * 4. So sánh hai chu kỳ (Compare Periods)
 */
export async function comparePerformancePeriods(params: {
  storeQuery?: string;
  period1: { startDate: string; endDate: string; label?: string };
  period2: { startDate: string; endDate: string; label?: string };
}) {
  const p1 = await getDailyMetricsSummary({
    storeQuery: params.storeQuery,
    startDate: params.period1.startDate,
    endDate: params.period1.endDate,
  });

  const p2 = await getDailyMetricsSummary({
    storeQuery: params.storeQuery,
    startDate: params.period2.startDate,
    endDate: params.period2.endDate,
  });

  if ("error" in p1 || "error" in p2) {
    return { error: "Không lấy được dữ liệu cho một trong hai chu kỳ so sánh." };
  }

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

  return {
    store: params.storeQuery || "Tất cả các store",
    period1Label: params.period1.label || `${params.period1.startDate} -> ${params.period1.endDate}`,
    period2Label: params.period2.label || `${params.period2.startDate} -> ${params.period2.endDate}`,
    comparison: {
      revenue: calcDiff(t2.totalRevenue, t1.totalRevenue),
      unitsSold: calcDiff(t2.totalQuantity, t1.totalQuantity),
      adsFee: calcDiff(t2.totalAdsFee, t1.totalAdsFee),
      returnCost: calcDiff(t2.totalReturnCost, t1.totalReturnCost),
      profit: calcDiff(t2.totalProfit, t1.totalProfit),
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
