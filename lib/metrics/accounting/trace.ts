import "server-only";

// Truy nguồn: lấy các DÒNG GỐC tạo nên một thành phần P&L (đơn hàng, dòng ADS, refund, giải ngân…)
// kèm TỔNG của toàn bộ dòng (không chỉ các dòng hiển thị) để đối chiếu với số trên Dashboard.
// FBA tính lại từng dòng đúng công thức listFbaDaily; FBM trả dòng gốc (công thức sheet FBM tính theo đơn).

import { withAgentReadOnly } from "@/lib/agent-core/db-guard";
import { excludeSupersededDeferredReturns, monthlyBasecostJoin, returnsEffectiveCte } from "@/lib/accounting/workbook-parity-sql";
import type { AccountingChannel } from "@/lib/accounting/access";
import { asinSkuMapSql, portfolioTailSql } from "@/lib/accounting/ads-portfolio-sku";
import type { PnlSnapshot } from "@/lib/metrics/accounting/source";

const ORDER_METRICS = ["revenue", "orders", "quantity", "basecost", "amazonFee", "tax", "promotion"] as const;
const ADS_METRICS = ["adsFee", "revenueAds", "clicks"] as const;
export const TRACEABLE_METRICS = [...ORDER_METRICS, ...ADS_METRICS, "returnCost", "serviceCost", "payout"] as const;
export type TraceableMetric = (typeof TRACEABLE_METRICS)[number];

const FX_SQL = `CASE o.currency WHEN 'USD' THEN 1.0 WHEN 'CAD' THEN 0.738 WHEN 'MXN' THEN 0.056 ELSE 0 END`;
const num = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

export interface TraceRequest {
  metric: TraceableMetric;
  storeId: string;
  channel: AccountingChannel;
  startDate: string;
  endDate: string;
  sku?: string;
  limit: number;
}

/** Cột sắp xếp dòng FBA theo chỉ số đang hỏi (dòng ảnh hưởng nhiều nhất lên trước). */
const FBA_ORDER_SORT: Record<(typeof ORDER_METRICS)[number], string> = {
  revenue: "revenue_usd",
  orders: "revenue_usd",
  quantity: "qty",
  basecost: "basecost",
  amazonFee: "amazon_fee",
  tax: "tax_on_order",
  promotion: "promotion",
};

export async function traceAccountingSource(snapshot: PnlSnapshot, req: TraceRequest) {
  const store = snapshot.storeChannels.find((s) => s.storeId === req.storeId);
  if (!store) throw new Error("Store không nằm trong phạm vi đang xem.");
  if (!store.channels.includes(req.channel)) {
    throw new Error(`Store ${store.storeName} không tính kênh ${req.channel} trong phạm vi này (kênh: ${store.channels.join(", ")}).`);
  }
  const { storeId, startDate, endDate } = req;
  if (!startDate || !endDate) throw new Error("Cần startDate / endDate để truy nguồn.");
  const sku = req.sku?.trim() || "";
  const head = { store: store.storeName, channel: req.channel, metric: req.metric, period: { startDate, endDate }, sku: sku || null };

  if (req.metric === "serviceCost") {
    if (req.channel === "FBM") return { ...head, note: "Dashboard không trừ phí dịch vụ cho FBM." };
    const row = snapshot.byStore.find((s) => s.key === storeId)?.row;
    return withAgentReadOnly(async (tx) => {
      const [s] = await tx`SELECT service_rate::float AS rate FROM stores WHERE id = ${storeId}`;
      const rate = s?.rate ?? 0.8572;
      const perDay = (20000 * rate) / 184;
      return {
        ...head,
        formula: "Phí dịch vụ/ngày = 20.000 × service_rate / 184; chỉ tính ngày có số liệu (đơn / ads / return).",
        serviceRate: rate,
        perDay: num(perDay),
        daysWithData: row?.days ?? null,
        expectedTotal: row ? num(perDay * row.days) : null,
        dashboardValue: row ? num(row.serviceCost) : null,
        note: snapshot.storeChannels.find((x) => x.storeId === storeId)?.channels.length === 2
          ? "Store chạy cả FBA và FBM: số ngày tính theo ngày có số liệu của từng kênh."
          : undefined,
      };
    });
  }

  if (req.metric === "payout") {
    return withAgentReadOnly(async (tx) => {
      const name = store.storeName.toUpperCase();
      const [total] = await tx`
        SELECT COUNT(*)::int AS lines, COALESCE(SUM(payout_amount), 0)::float AS total
        FROM accounting_payout_disbursements
        WHERE payout_status = 'Done' AND store_name = ${name}
          AND acknowledged_date >= ${startDate}::date AND acknowledged_date <= ${endDate}::date
      `;
      const rows = await tx`
        SELECT acknowledged_date::text AS date, payout_amount::float AS amount, currency,
          period_start::text, period_end::text, settlement_group, trace_id
        FROM accounting_payout_disbursements
        WHERE payout_status = 'Done' AND store_name = ${name}
          AND acknowledged_date >= ${startDate}::date AND acknowledged_date <= ${endDate}::date
        ORDER BY acknowledged_date DESC
        LIMIT ${req.limit}
      `;
      return {
        ...head,
        source: "accounting_payout_disbursements (trạng thái Done, theo ngày ghi nhận)",
        totals: { lines: total.lines, amount: num(total.total) },
        rows,
      };
    });
  }

  if ((ADS_METRICS as readonly string[]).includes(req.metric)) {
    return withAgentReadOnly(async (tx) => {
      const channelFilter =
        req.channel === "FBA"
          ? tx`AND UPPER(TRIM(a.loai)) = 'FBA'`
          : tx`AND (
              ${portfolioTailSql(tx, "a.portfolio")} IN (
                SELECT UPPER(TRIM(m.sku)) FROM accounting_sku_master_fbm m
                WHERE m.store_id = ${storeId} AND m.deleted_at IS NULL AND UPPER(TRIM(COALESCE(m.loai, ''))) = 'FBM'
              )
              -- Portfolio đặt nhầm ASIN thay SKU ở chữ cuối
              OR ${portfolioTailSql(tx, "a.portfolio")} IN (
                SELECT x.asin_key FROM (${asinSkuMapSql(tx, "fbm", [storeId])}) x
                JOIN accounting_sku_master_fbm m ON m.store_id = x.store_id AND UPPER(TRIM(m.sku)) = x.sku_key
                WHERE m.deleted_at IS NULL AND UPPER(TRIM(COALESCE(m.loai, ''))) = 'FBM'
              )
            )`;
      const skuFilter = sku
        ? tx`AND (UPPER(TRIM(a.sku)) = UPPER(${sku}) OR a.portfolio ILIKE ${"%" + sku}
            OR ${portfolioTailSql(tx, "a.portfolio")} IN (
              SELECT x.asin_key FROM (${asinSkuMapSql(tx, req.channel === "FBA" ? "fba" : "fbm", [storeId])}) x
              WHERE x.sku_key = UPPER(TRIM(${sku}))
            )) `
        : tx``;
      const where = tx`
        WHERE a.store_id = ${storeId}
          AND a.date >= ${startDate}::date AND a.date <= ${endDate}::date AND a.date < CURRENT_DATE
          ${channelFilter} ${skuFilter}
      `;
      const [total] = await tx`
        SELECT COUNT(*)::int AS lines, COALESCE(SUM(spend), 0)::float AS spend,
          COALESCE(SUM(sales), 0)::float AS sales, COALESCE(SUM(clicks), 0)::float AS clicks
        FROM accounting_ads a ${where}
      `;
      const rows = await tx`
        SELECT a.portfolio, a.sku, a.loai, COUNT(DISTINCT a.date)::int AS days,
          ROUND(SUM(COALESCE(a.spend, 0))::numeric, 2)::float AS spend,
          ROUND(SUM(COALESCE(a.sales, 0))::numeric, 2)::float AS sales,
          SUM(COALESCE(a.clicks, 0))::int AS clicks
        FROM accounting_ads a ${where}
        GROUP BY a.portfolio, a.sku, a.loai
        ORDER BY ${req.metric === "revenueAds" ? tx`sales` : req.metric === "clicks" ? tx`clicks` : tx`spend`} DESC
        LIMIT ${req.limit}
      `;
      return {
        ...head,
        source: "accounting_ads (file ADS), gộp theo Portfolio",
        rule: req.channel === "FBA" ? "Chỉ dòng có Loại = FBA." : "Chỉ Portfolio có SKU (chữ cuối; chữ cuối là ASIN thì tra ra SKU) thuộc Bảng mã FBM Loại FBM (gần đúng với công thức tab FBM).",
        totals: { lines: total.lines, spend: num(total.spend), sales: num(total.sales), clicks: Number(total.clicks) },
        rows,
      };
    });
  }

  if (req.metric === "returnCost") {
    return withAgentReadOnly(async (tx) => {
      const skuFilter = sku ? tx`AND UPPER(TRIM(COALESCE(r.sku, ''))) = UPPER(${sku})` : tx``;
      const where = tx`
        WHERE r.store_id = ${storeId}
          AND r.date >= ${startDate}::date AND r.date <= ${endDate}::date AND r.date < CURRENT_DATE
          ${excludeSupersededDeferredReturns(tx as never, "r")}
          ${skuFilter}
      `;
      const [total] = await tx`
        SELECT COUNT(*)::int AS lines, COALESCE(SUM(r.total), 0)::float AS total FROM accounting_returns r ${where}
      `;
      // Tổng Return đúng công thức Dashboard: FBA dùng returnsEffectiveCte (cộng lại giá vốn hàng về kho, lọc Loại FBA).
      let dashboardFormulaTotal: number | null = null;
      if (req.channel === "FBA" && !sku) {
        const [eff] = await tx`
          WITH ${returnsEffectiveCte(tx as never, storeId, tx`AND r.date >= ${startDate}::date AND r.date <= ${endDate}::date AND r.date < CURRENT_DATE`)}
          SELECT COUNT(*)::int AS lines, COALESCE(-SUM(return_value), 0)::float AS return_cost
          FROM returns_effective WHERE UPPER(TRIM(COALESCE(loai, ''))) = 'FBA'
        `;
        dashboardFormulaTotal = num(eff.return_cost);
      }
      const rows = await tx`
        SELECT r.date::text AS date, r.order_id, r.sku, r.loai, r.transaction_status, r.transaction_type,
          r.total::float AS total, r.basecost::float AS basecost
        FROM accounting_returns r ${where}
        ORDER BY r.total ASC
        LIMIT ${req.limit}
      `;
      return {
        ...head,
        source: "accounting_returns (Transaction report), đã bỏ dòng Deferred đã có Released",
        rule:
          req.channel === "FBA"
            ? "Return FBA = −(Total + quantity × Basecost tháng của dòng đơn đầu tiên), chỉ dòng có Loại (theo Bảng mã của SKU đơn gốc) = FBA. totalOriginal = Total gốc của MỌI dòng refund của store (chưa lọc kênh, chưa cộng lại giá vốn); returnCostDashboardFormula = đúng số Return trên Dashboard."
            : "Return FBM = −Total, chỉ dòng có Loại (Bảng mã FBM của SKU đơn gốc) = FBM. Tổng dưới đây là Total gốc của MỌI dòng refund của store (chưa lọc kênh).",
        totals: {
          lines: total.lines,
          totalOriginal: num(total.total),
          ...(dashboardFormulaTotal != null ? { returnCostDashboardFormula: dashboardFormulaTotal } : {}),
        },
        rows,
      };
    });
  }

  // Thành phần lấy từ đơn hàng
  const metric = req.metric as (typeof ORDER_METRICS)[number];
  if (req.channel === "FBM") {
    return withAgentReadOnly(async (tx) => {
      const skuFilter = sku ? tx`AND UPPER(TRIM(COALESCE(o.sku, ''))) = UPPER(${sku})` : tx``;
      const where = tx`
        WHERE o.store_id = ${storeId} AND o.fulfillment_channel = 'Merchant'
          AND o.date >= ${startDate}::date AND o.date <= ${endDate}::date AND o.date < CURRENT_DATE
          ${skuFilter}
      `;
      const [total] = await tx`
        SELECT COUNT(*)::int AS lines,
          COUNT(DISTINCT o.amazon_order_id) FILTER (WHERE LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled'))::int AS orders,
          COALESCE(SUM(CASE WHEN COALESCE(o.currency, '') <> '' THEN o.quantity ELSE 0 END), 0)::int AS quantity,
          COALESCE(SUM((COALESCE(o.item_price, 0) + COALESCE(o.shipping_price, 0)) * ${tx.unsafe(FX_SQL)}), 0)::float AS revenue_usd,
          COALESCE(SUM(COALESCE(o.item_promotion_discount, 0)), 0)::float AS promotion
        FROM accounting_orders o ${where}
      `;
      const rows = await tx`
        SELECT o.date::text AS date, o.amazon_order_id, o.sku, o.asin, o.quantity, o.currency, o.order_status,
          o.item_price::float, o.shipping_price::float, o.item_promotion_discount::float AS promotion,
          ROUND(((COALESCE(o.item_price, 0) + COALESCE(o.shipping_price, 0)) * ${tx.unsafe(FX_SQL)})::numeric, 2)::float AS revenue_usd
        FROM accounting_orders o ${where}
        ORDER BY revenue_usd DESC
        LIMIT ${req.limit}
      `;
      return {
        ...head,
        source: "accounting_orders (Orders FBM)",
        rule:
          "FBM: Revenue = (item + shipping) quy đổi USD; Base cost = PW của đơn (dòng đầu Order ID) hoặc quantity × Total cost Bảng mã FBM; Amazon Fee = Revenue × % Referral. Xem chi tiết từng đơn ở tab FBM.",
        totals: {
          lines: total.lines,
          orders: total.orders,
          quantity: total.quantity,
          revenue: num(total.revenue_usd),
          promotion: num(total.promotion),
        },
        rows,
      };
    });
  }

  return withAgentReadOnly(async (tx) => {
    const skuFilter = sku ? tx`AND o.sku = ${sku}` : tx``;
    // Từng dòng đơn FBA tính lại đúng công thức listFbaDaily (lib/accounting/fba-daily-db.ts)
    const lines = tx`
      WITH asin_fees AS (
        SELECT store_id, asin, MAX(amazon_fee) AS amazon_fee, MAX(referral_fee_pct) AS referral_fee_pct
        FROM accounting_sku_master
        WHERE store_id = ${storeId} AND asin IS NOT NULL AND asin <> ''
        GROUP BY store_id, asin
      ),
      l AS (
        SELECT o.date, o.amazon_order_id, o.sku, o.asin, o.currency, o.item_price,
          o.amazon_order_id LIKE 'S0%' AS is_s0,
          CASE WHEN o.amazon_order_id NOT LIKE 'S0%' THEN COALESCE(o.quantity, 1) ELSE 0 END AS qty,
          COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)} AS revenue_usd,
          COALESCE(mbc.basecost_thang, sm.basecost_tb, 0) AS unit_basecost,
          CASE WHEN mbc.basecost_thang IS NOT NULL THEN 'BASECOST THÁNG'
               WHEN sm.basecost_tb IS NOT NULL THEN 'Basecost TB (Bảng mã)' ELSE 'KHÔNG CÓ (= 0)' END AS basecost_source,
          CASE WHEN o.amazon_order_id NOT LIKE 'S0%' THEN COALESCE(o.quantity, 1) * COALESCE(mbc.basecost_thang, sm.basecost_tb, 0) ELSE 0 END AS basecost,
          COALESCE(sm.amazon_fee, af.amazon_fee, 0) AS fee_per_unit,
          COALESCE(sm.referral_fee_pct, af.referral_fee_pct, 0) AS referral_pct,
          CASE WHEN COALESCE(o.item_price, 0) = 0 THEN 0
               ELSE COALESCE(sm.amazon_fee, af.amazon_fee, 0) * COALESCE(o.quantity, 1)
                  + COALESCE(sm.referral_fee_pct, af.referral_fee_pct, 0) * COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)} END AS amazon_fee,
          COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)} * (0.01 + COALESCE(sm.referral_fee_pct, af.referral_fee_pct, 0) * 0.10) AS tax_on_order,
          COALESCE(o.item_promotion_discount, 0) + COALESCE(o.ship_promotion_discount, 0) AS promotion
        FROM accounting_orders o
        LEFT JOIN asin_fees af ON af.store_id = o.store_id AND af.asin = o.asin
        LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
        ${monthlyBasecostJoin(tx as never)}
        WHERE o.store_id = ${storeId} AND o.fulfillment_channel = 'Amazon'
          AND o.date >= ${startDate}::date AND o.date <= ${endDate}::date AND o.date < CURRENT_DATE
          AND o.currency IN ('USD', 'CAD', 'MXN')
          AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
          ${skuFilter}
      )
    `;
    const [total] = await tx`
      ${lines}
      SELECT COUNT(*)::int AS lines,
        COUNT(DISTINCT CASE WHEN NOT is_s0 THEN amazon_order_id END)::int AS orders,
        COALESCE(SUM(qty), 0)::int AS quantity,
        COALESCE(SUM(revenue_usd), 0)::float AS revenue,
        COALESCE(SUM(basecost), 0)::float AS basecost,
        COALESCE(SUM(amazon_fee), 0)::float AS amazon_fee,
        COALESCE(SUM(tax_on_order), 0)::float AS tax_on_orders,
        COALESCE(SUM(promotion), 0)::float AS promotion,
        COUNT(*) FILTER (WHERE basecost_source = 'KHÔNG CÓ (= 0)' AND NOT is_s0)::int AS lines_missing_basecost
      FROM l
    `;
    const rows = await tx`
      ${lines}
      SELECT date::text AS date, amazon_order_id, sku, asin, qty, currency, item_price::float,
        ROUND(revenue_usd::numeric, 2)::float AS revenue_usd,
        ROUND(unit_basecost::numeric, 2)::float AS unit_basecost, basecost_source,
        ROUND(basecost::numeric, 2)::float AS basecost,
        ROUND(fee_per_unit::numeric, 2)::float AS fee_per_unit, referral_pct::float,
        ROUND(amazon_fee::numeric, 2)::float AS amazon_fee,
        ROUND(tax_on_order::numeric, 2)::float AS tax_on_order,
        ROUND(promotion::numeric, 2)::float AS promotion
      FROM l
      ORDER BY ${tx.unsafe(FBA_ORDER_SORT[metric])} DESC
      LIMIT ${req.limit}
    `;
    return {
      ...head,
      source: "accounting_orders (Orders FBA) + Bảng mã + Basecost tháng",
      rule:
        metric === "tax"
          ? "Thuế FBA = Σ tax_on_order (1% Revenue + 10% × Referral% × Revenue) + 10% × Ad Spend (phần Ads xem trace adsFee)."
          : "Mỗi dòng đã tính lại đúng công thức tab FBA; cột *_source cho biết giá vốn lấy từ đâu.",
      totals: {
        lines: total.lines,
        orders: total.orders,
        quantity: total.quantity,
        revenue: num(total.revenue),
        basecost: num(total.basecost),
        amazonFee: num(total.amazon_fee),
        taxOnOrders: num(total.tax_on_orders),
        promotion: num(total.promotion),
        linesMissingBasecost: total.lines_missing_basecost,
      },
      rows,
    };
  });
}
