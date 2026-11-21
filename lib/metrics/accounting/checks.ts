import "server-only";

// Kiểm tra chất lượng dữ liệu kế toán: phần lớn câu hỏi "sao số lạ vậy" là do dữ liệu thiếu / chưa khớp
// (SKU thiếu giá vốn, thiếu file ADS, refund chưa chốt…). Mỗi kiểm tra trả về trạng thái + ảnh hưởng tới số nào.
// Điều kiện lọc giống hệt listFbaDaily / listFbmDaily để con số kiểm tra khớp với P&L.

import type { TransactionSql } from "postgres";
import { withAgentReadOnly } from "@/lib/agent-core/db-guard";
import { monthlyBasecostJoin } from "@/lib/accounting/workbook-parity-sql";
import type { PnlSnapshot } from "@/lib/metrics/accounting/source";
import { asinSkuMapSql } from "@/lib/accounting/ads-portfolio-sku";

export type CheckStatus = "ok" | "warning" | "info";

export interface DataCheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  /** Ảnh hưởng tới chỉ số nào, theo hướng nào. */
  impact?: string;
  items?: Record<string, unknown>[];
}

export const ACCOUNTING_CHECK_IDS = [
  "data_lag",
  "missing_basecost",
  "missing_fee_master",
  "unsupported_currency",
  "ads_gap_days",
  "ads_unmapped",
  "ads_without_revenue",
  "pending_returns",
  "fbm_sku_not_in_master",
  // Đối chiếu với nguồn độc lập / lịch sử (bắt được lỗi "nhập sai nhưng không để trống")
  "fee_vs_actual",
  "costs_not_in_dashboard",
  "basecost_outlier",
  "daily_anomaly",
] as const;
export type AccountingCheckId = (typeof ACCOUNTING_CHECK_IDS)[number];

const FX_SQL = `CASE o.currency WHEN 'USD' THEN 1.0 WHEN 'CAD' THEN 0.738 WHEN 'MXN' THEN 0.056 ELSE 0 END`;
const ITEM_LIMIT = 15;
const r2 = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

interface CheckTarget {
  fbaStoreIds: string[];
  fbmStoreIds: string[];
  storeName: Map<string, string>;
  startDate: string;
  endDate: string;
}

function targetsOf(snapshot: PnlSnapshot, storeId?: string): CheckTarget {
  const stores = snapshot.storeChannels.filter((s) => !storeId || s.storeId === storeId);
  return {
    fbaStoreIds: stores.filter((s) => s.channels.includes("FBA")).map((s) => s.storeId),
    fbmStoreIds: stores.filter((s) => s.channels.includes("FBM")).map((s) => s.storeId),
    storeName: new Map(stores.map((s) => [s.storeId, s.storeName])),
    startDate: snapshot.period.startDate,
    endDate: snapshot.period.endDate,
  };
}

type Runner = (tx: TransactionSql, t: CheckTarget, snapshot: PnlSnapshot) => Promise<DataCheckResult>;

const withStore = (t: CheckTarget, rows: Record<string, unknown>[]) =>
  rows.map(({ store_id, ...rest }) => ({ store: t.storeName.get(String(store_id)) ?? store_id, ...rest }));

const RUNNERS: Record<AccountingCheckId, Runner> = {
  async data_lag(_tx, t, snapshot) {
    const lagging = snapshot.dataLag?.stores ?? [];
    const clamped = snapshot.period.endDate && snapshot.period.endDate === snapshot.latestDate;
    return {
      id: "data_lag",
      title: "Độ mới của dữ liệu",
      status: lagging.length ? "warning" : "info",
      summary: lagging.length
        ? `Có store chưa có số tới ${snapshot.latestDate}: ${lagging.map((s) => `${s.name} (tới ${s.through ?? "chưa có"})`).join(", ")}.`
        : `Dữ liệu đã có tới ${snapshot.latestDate}. Không tính ngày hôm nay (số trong ngày chưa đủ).`,
      impact: lagging.length
        ? "Store chậm số làm Revenue / Profit kỳ này thấp hơn thực tế cho tới khi crawler / import bổ sung."
        : clamped
          ? "Kỳ được cắt tới ngày dữ liệu mới nhất."
          : undefined,
      items: lagging.map((s) => ({ store: s.name, through: s.through })),
    };
  },

  async missing_basecost(tx, t) {
    if (!t.fbaStoreIds.length || !t.startDate) return skip("missing_basecost", "SKU thiếu giá vốn (FBA)");
    const rows = await tx`
      SELECT o.store_id, o.sku,
        SUM(COALESCE(o.quantity, 1))::int AS units,
        ROUND(SUM(COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)})::numeric, 2)::float AS revenue
      FROM accounting_orders o
      LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
      ${monthlyBasecostJoin(tx as never)}
      WHERE o.store_id = ANY(${t.fbaStoreIds}) AND o.fulfillment_channel = 'Amazon'
        AND o.date >= ${t.startDate}::date AND o.date <= ${t.endDate}::date AND o.date < CURRENT_DATE
        AND o.currency IN ('USD', 'CAD', 'MXN')
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
        AND COALESCE(o.amazon_order_id, '') NOT LIKE 'S0%'
        AND COALESCE(mbc.basecost_thang, sm.basecost_tb, 0) = 0
      GROUP BY o.store_id, o.sku
      ORDER BY revenue DESC
      LIMIT 200
    `;
    const units = rows.reduce((s, r) => s + Number(r.units), 0);
    const revenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
    return {
      id: "missing_basecost",
      title: "SKU thiếu giá vốn (FBA)",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `${rows.length} SKU bán ${units} unit (doanh thu ${r2(revenue)}$) nhưng giá vốn = 0: không có BASECOST THÁNG của tháng đó và không có Basecost TB trong Bảng mã.`
        : "Mọi SKU FBA bán trong kỳ đều có giá vốn.",
      impact: rows.length ? "Base cost bị thấp ⇒ Profit / Margin / ROI bị CAO ẢO." : undefined,
      items: withStore(t, rows.slice(0, ITEM_LIMIT)),
    };
  },

  /**
   * SKU FBA để TRỐNG phí FBA/unit trong Bảng mã (theo SKU lẫn ASIN). Dashboard vẫn trừ % referral nhưng KHÔNG trừ phí
   * FBA (phí xử lý + giao hàng của Amazon) ⇒ thiếu phí thật. Ước tính phần thiếu theo phí FBA thật / unit gần nhất của
   * chính SKU (báo cáo tháng), không có thì theo trung vị phí FBA của các SKU cùng phôi trong store.
   */
  async missing_fee_master(tx, t) {
    if (!t.fbaStoreIds.length || !t.startDate) return skip("missing_fee_master", "SKU thiếu phí FBA/unit trong Bảng mã");
    const rows = await tx<{ store_id: string; sku: string; product_type: string | null; units: number; revenue: number; referral_pct: number | null; ref_fee_unit: number | null; ref_source: string | null }[]>`
      WITH asin_fees AS (
        SELECT store_id, asin, MAX(amazon_fee) AS amazon_fee, MAX(referral_fee_pct) AS referral_fee_pct
        FROM accounting_sku_master
        WHERE store_id = ANY(${t.fbaStoreIds}) AND asin IS NOT NULL AND asin <> ''
        GROUP BY store_id, asin
      ),
      missing AS (
        SELECT o.store_id, o.sku, MAX(sm.product_type) AS product_type,
          SUM(COALESCE(o.quantity, 1))::int AS units,
          ROUND(SUM(COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)})::numeric, 2)::float AS revenue,
          MAX(COALESCE(sm.referral_fee_pct, af.referral_fee_pct))::float AS referral_pct
        FROM accounting_orders o
        LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
        LEFT JOIN asin_fees af ON af.store_id = o.store_id AND af.asin = o.asin
        WHERE o.store_id = ANY(${t.fbaStoreIds}) AND o.fulfillment_channel = 'Amazon'
          AND o.date >= ${t.startDate}::date AND o.date <= ${t.endDate}::date AND o.date < CURRENT_DATE
          AND o.currency IN ('USD', 'CAD', 'MXN')
          AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
          AND COALESCE(o.item_price, 0) <> 0
          AND COALESCE(sm.amazon_fee, af.amazon_fee) IS NULL
        GROUP BY o.store_id, o.sku
      )
      SELECT m.*,
        COALESCE(own.fee_unit, peer.fee_unit)::float AS ref_fee_unit,
        CASE WHEN own.fee_unit IS NOT NULL THEN 'phí thật tháng ' || own.ym
             WHEN peer.fee_unit IS NOT NULL THEN 'trung vị phí FBA của ' || peer.n || ' SKU cùng phôi' END AS ref_source
      FROM missing m
      LEFT JOIN LATERAL (
        -- Phí thật / unit gần nhất của chính SKU, trừ phần referral để còn phí FBA
        SELECT to_char(make_date(k.year, k.month, 1), 'YYYY-MM') AS ym,
          (-(COALESCE(k.amazon_fee_trans, 0) + COALESCE(k.amazon_fee_unrecognized, 0)) - COALESCE(m.referral_pct, 0) * k.revenue) / k.quantity AS fee_unit
        FROM accounting_sku_monthly k
        WHERE k.store_id = m.store_id AND k.sku = m.sku AND k.quantity > 0
        ORDER BY k.year DESC, k.month DESC LIMIT 1
      ) own ON true
      LEFT JOIN LATERAL (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.amazon_fee) AS fee_unit, COUNT(*)::int AS n
        FROM accounting_sku_master p
        WHERE p.store_id = m.store_id AND p.product_type = m.product_type AND p.amazon_fee > 0 AND p.deleted_at IS NULL
        HAVING COUNT(*) > 0
      ) peer ON true
      ORDER BY m.revenue DESC
      LIMIT 200
    `;
    const items = rows.map((r) => ({
      store: t.storeName.get(r.store_id) ?? r.store_id,
      sku: r.sku,
      productType: r.product_type,
      units: r.units,
      revenue: r.revenue,
      referralCharged: r.referral_pct != null ? `${r2(r.referral_pct * 100)}% (vẫn được trừ)` : "không có",
      estFbaFeePerUnit: r.ref_fee_unit != null && r.ref_fee_unit > 0 ? r2(r.ref_fee_unit) : null,
      estMissing: r.ref_fee_unit != null && r.ref_fee_unit > 0 ? r2(r.ref_fee_unit * r.units) : null,
      estBasis: r.ref_source,
    }));
    const missingTotal = items.reduce((s2, i) => s2 + (i.estMissing ?? 0), 0);
    return {
      id: "missing_fee_master",
      title: "SKU thiếu phí FBA/unit trong Bảng mã",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `${rows.length} SKU FBA để TRỐNG phí FBA/unit trong Bảng mã: Dashboard chỉ trừ % referral, KHÔNG trừ phí FBA (phí xử lý + giao hàng)${missingTotal ? ` — ước tính thiếu khoảng ${r2(missingTotal)}$ phí` : ""}.`
        : "Mọi SKU FBA bán trong kỳ đều có phí FBA/unit trong Bảng mã.",
      impact: rows.length
        ? "Amazon Fee THẤP ẢO ⇒ Profit CAO ẢO đúng bằng phần phí FBA thiếu. Đã có % referral KHÔNG có nghĩa là đủ phí: referral và phí FBA là 2 khoản riêng. Sửa: điền phí FBA/unit cho SKU trong Bảng mã."
        : undefined,
      items: items.slice(0, ITEM_LIMIT),
    };
  },

  async unsupported_currency(tx, t) {
    const ids = [...new Set([...t.fbaStoreIds, ...t.fbmStoreIds])];
    if (!ids.length || !t.startDate) return skip("unsupported_currency", "Đơn tiền tệ không hỗ trợ");
    const rows = await tx`
      SELECT o.store_id, o.fulfillment_channel AS channel, COALESCE(NULLIF(o.currency, ''), '(trống)') AS currency,
        COUNT(*)::int AS lines, ROUND(SUM(COALESCE(o.item_price, 0))::numeric, 2)::float AS item_price_original
      FROM accounting_orders o
      WHERE o.store_id = ANY(${ids})
        AND o.date >= ${t.startDate}::date AND o.date <= ${t.endDate}::date AND o.date < CURRENT_DATE
        AND COALESCE(o.currency, '') NOT IN ('USD', 'CAD', 'MXN')
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY 1, 2, 3
      ORDER BY lines DESC
      LIMIT ${ITEM_LIMIT}
    `;
    return {
      id: "unsupported_currency",
      title: "Đơn có tiền tệ ngoài USD / CAD / MXN",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `${rows.reduce((s, r) => s + Number(r.lines), 0)} dòng đơn có tiền tệ không hỗ trợ (thường là đơn Pending chưa có giá).`
        : "Không có đơn tiền tệ lạ.",
      impact: rows.length ? "FBA: các dòng này bị bỏ khỏi P&L. FBM: tính doanh thu = 0." : undefined,
      items: withStore(t, rows),
    };
  },

  async ads_gap_days(tx, t) {
    if (!t.fbaStoreIds.length || !t.startDate) return skip("ads_gap_days", "Ngày có đơn nhưng không có ADS");
    const rows = await tx`
      WITH od AS (
        SELECT DISTINCT store_id, date FROM accounting_orders
        WHERE store_id = ANY(${t.fbaStoreIds}) AND fulfillment_channel = 'Amazon'
          AND date >= ${t.startDate}::date AND date <= ${t.endDate}::date AND date < CURRENT_DATE
      ),
      ad AS (
        SELECT DISTINCT store_id, date FROM accounting_ads
        WHERE store_id = ANY(${t.fbaStoreIds})
          AND date >= ${t.startDate}::date AND date <= ${t.endDate}::date
      )
      SELECT od.store_id, string_agg(to_char(od.date, 'YYYY-MM-DD'), ', ' ORDER BY od.date) AS dates, COUNT(*)::int AS days
      FROM od LEFT JOIN ad ON ad.store_id = od.store_id AND ad.date = od.date
      WHERE ad.date IS NULL
      GROUP BY od.store_id
      LIMIT 50
    `;
    return {
      id: "ads_gap_days",
      title: "Ngày có đơn nhưng không có dữ liệu ADS",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `Có ${rows.reduce((s, r) => s + Number(r.days), 0)} ngày-store có đơn FBA nhưng không có dòng ADS nào (có thể thiếu file ADS).`
        : "Ngày nào có đơn cũng có dữ liệu ADS.",
      impact: rows.length ? "Ad Spend bị thiếu ⇒ Profit CAO ẢO, TACOS / ACOS THẤP ẢO ở các ngày đó." : undefined,
      items: withStore(t, rows),
    };
  },

  async ads_unmapped(tx, t) {
    const ids = [...new Set([...t.fbaStoreIds, ...t.fbmStoreIds])];
    if (!ids.length || !t.startDate) return skip("ads_unmapped", "Chi phí ADS không thuộc kênh nào");
    const rows = await tx`
      WITH fbm_sku_rows AS (
        SELECT DISTINCT store_id, UPPER(TRIM(sku)) AS sku_key
        FROM accounting_sku_master_fbm
        WHERE store_id = ANY(${ids}) AND deleted_at IS NULL AND UPPER(TRIM(COALESCE(loai, ''))) = 'FBM'
      ),
      -- Chữ cuối portfolio là SKU, hoặc ASIN (đặt nhầm) của SKU đó
      fbm_skus AS (
        SELECT store_id, sku_key FROM fbm_sku_rows
        UNION
        SELECT x.store_id, x.asin_key FROM (${asinSkuMapSql(tx, "fbm", ids)}) x
        JOIN fbm_sku_rows r ON r.store_id = x.store_id AND r.sku_key = x.sku_key
      )
      SELECT a.store_id, a.portfolio, COALESCE(NULLIF(TRIM(a.loai), ''), '(trống)') AS loai,
        ROUND(SUM(COALESCE(a.spend, 0))::numeric, 2)::float AS spend
      FROM accounting_ads a
      LEFT JOIN fbm_skus f ON f.store_id = a.store_id
        AND f.sku_key = UPPER(substring(COALESCE(a.portfolio, '') from '([^ ]*)$'))
      WHERE a.store_id = ANY(${ids})
        AND a.date >= ${t.startDate}::date AND a.date <= ${t.endDate}::date AND a.date < CURRENT_DATE
        AND UPPER(TRIM(COALESCE(a.loai, ''))) <> 'FBA'
        AND f.sku_key IS NULL
      GROUP BY 1, 2, 3
      HAVING SUM(COALESCE(a.spend, 0)) > 0
      ORDER BY spend DESC
      LIMIT 100
    `;
    const spend = rows.reduce((s, r) => s + Number(r.spend), 0);
    return {
      id: "ads_unmapped",
      title: "Chi phí ADS không được tính vào kênh nào",
      status: spend > 1 ? "warning" : "ok",
      summary:
        spend > 1
          ? `${r2(spend)}$ chi phí ADS (${rows.length} portfolio) có Loại khác FBA và SKU ở cuối Portfolio không thuộc Bảng mã FBM ⇒ không nằm trong P&L.`
          : "Mọi chi phí ADS đều được gán vào FBA hoặc FBM.",
      impact: spend > 1 ? "Ad Spend trên Dashboard THẤP hơn tổng tiền ADS thực trả ⇒ Profit CAO ẢO." : undefined,
      items: withStore(t, rows.slice(0, ITEM_LIMIT)),
    };
  },

  async ads_without_revenue(_tx, _t, snapshot) {
    const rows = snapshot.byStore
      .filter((s) => s.row.adsFee > 0 && s.row.revenue === 0)
      .map((s) => ({ store: s.label, adsFee: r2(s.row.adsFee) }));
    return {
      id: "ads_without_revenue",
      title: "Store có chi ADS nhưng không có doanh thu",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `${rows.map((r) => r.store).join(", ")} có Ad Spend nhưng Revenue = 0 — kiểm tra file Orders hoặc mapping ADS.`
        : "Không có store nào chi ADS mà không có doanh thu.",
      items: rows,
    };
  },

  async pending_returns(tx, t) {
    const ids = [...new Set([...t.fbaStoreIds, ...t.fbmStoreIds])];
    if (!ids.length || !t.startDate) return skip("pending_returns", "Refund chưa chốt (Deferred)");
    const rows = await tx`
      SELECT r.store_id, COUNT(*)::int AS lines, ROUND(SUM(COALESCE(r.total, 0))::numeric, 2)::float AS total
      FROM accounting_returns r
      WHERE r.store_id = ANY(${ids})
        AND r.date >= ${t.startDate}::date AND r.date <= ${t.endDate}::date
        AND r.transaction_status = 'Deferred'
        AND NOT EXISTS (
          SELECT 1 FROM accounting_returns rel
          WHERE rel.store_id = r.store_id AND rel.order_id = r.order_id
            AND rel.total = r.total AND rel.transaction_status = 'Released'
        )
      GROUP BY r.store_id
      LIMIT 50
    `;
    const lines = rows.reduce((s, r) => s + Number(r.lines), 0);
    return {
      id: "pending_returns",
      title: "Refund đang Deferred (chưa Released)",
      status: lines ? "info" : "ok",
      summary: lines
        ? `${lines} dòng refund Deferred chưa có Released (tổng ${r2(rows.reduce((s, r) => s + Number(r.total), 0))}$) — vẫn được tính vào Return.`
        : "Không có refund Deferred treo.",
      impact: lines ? "Khi Amazon Released, dòng Deferred trùng sẽ được bỏ; nếu số tiền Released khác thì Return kỳ này có thể đổi." : undefined,
      items: withStore(t, rows),
    };
  },

  async fbm_sku_not_in_master(tx, t) {
    if (!t.fbmStoreIds.length || !t.startDate) return skip("fbm_sku_not_in_master", "SKU FBM không có trong Bảng mã FBM");
    const rows = await tx`
      SELECT o.store_id, o.sku,
        SUM(COALESCE(o.quantity, 0))::int AS units,
        ROUND(SUM((COALESCE(o.item_price, 0) + COALESCE(o.shipping_price, 0)) * ${tx.unsafe(FX_SQL)})::numeric, 2)::float AS revenue
      FROM accounting_orders o
      WHERE o.store_id = ANY(${t.fbmStoreIds}) AND o.fulfillment_channel = 'Merchant'
        AND o.date >= ${t.startDate}::date AND o.date <= ${t.endDate}::date AND o.date < CURRENT_DATE
        AND COALESCE(o.currency, '') <> '' AND COALESCE(TRIM(o.sku), '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM accounting_sku_master_fbm m
          WHERE m.store_id = o.store_id AND m.deleted_at IS NULL AND UPPER(TRIM(m.sku)) = UPPER(TRIM(o.sku))
        )
      GROUP BY o.store_id, o.sku
      ORDER BY revenue DESC
      LIMIT 200
    `;
    return {
      id: "fbm_sku_not_in_master",
      title: "SKU FBM không có trong Bảng mã FBM",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `${rows.length} SKU FBM có doanh thu ${r2(rows.reduce((s, r) => s + Number(r.revenue), 0))}$ nhưng không có trong Bảng mã FBM.`
        : "Mọi SKU FBM bán trong kỳ đều có trong Bảng mã FBM.",
      impact: rows.length ? "Base cost và Amazon Fee của các SKU này = 0 (trừ đơn có PW) ⇒ Profit FBM CAO ẢO." : undefined,
      items: withStore(t, rows.slice(0, ITEM_LIMIT)),
    };
  },

  /**
   * Phí Amazon ƯỚC TÍNH (Dashboard, theo Bảng mã) so với phí THẬT trong báo cáo giao dịch (bảng tổng kết tháng do
   * scripts/ingest_monthly_from_raw.py tạo: amazon_fee_trans = phí thật của đơn đã thanh toán, amazon_fee_unrecognized =
   * phí ước tính của đơn chưa thanh toán). So cả THÁNG (báo cáo tháng chỉ có theo tháng), chỉ các tháng đã có báo cáo.
   * Lệch nhiều thường do phí FBA / % referral trong Bảng mã đã cũ → chỉ ra các SKU lệch nhất.
   */
  async fee_vs_actual(tx, t) {
    if (!t.fbaStoreIds.length || !t.startDate) return skip("fee_vs_actual", "Phí Amazon ước tính so với phí thật");
    const months = await tx<{ store_id: string; ym: string; month_start: string; month_end: string; actual: number; revenue: number }[]>`
      SELECT m.store_id, to_char(make_date(m.year, m.month, 1), 'YYYY-MM') AS ym,
        make_date(m.year, m.month, 1)::text AS month_start,
        (make_date(m.year, m.month, 1) + interval '1 month - 1 day')::date::text AS month_end,
        (-(COALESCE(m.total_amazon_fee_trans, 0) + COALESCE(m.total_amazon_fee_unrecognized, 0)))::float AS actual,
        COALESCE(m.total_revenue, 0)::float AS revenue
      FROM accounting_monthly_store_summary m
      WHERE m.store_id = ANY(${t.fbaStoreIds})
        AND make_date(m.year, m.month, 1) <= ${t.endDate}::date
        AND (make_date(m.year, m.month, 1) + interval '1 month - 1 day')::date >= ${t.startDate}::date
      ORDER BY 2 DESC
      LIMIT 24
    `;
    if (!months.length) {
      // Kỳ chưa chốt tháng (thường là tháng hiện tại): lấy phí thật / unit của tháng GẦN NHẤT đã có báo cáo so với
      // phí ước tính / unit kỳ này của từng SKU đang bán → ước lượng Dashboard đang tính thiếu bao nhiêu.
      const latest = await tx<{ store_id: string; ym: string }[]>`
        SELECT DISTINCT ON (store_id) store_id, to_char(make_date(year, month, 1), 'YYYY-MM') AS ym
        FROM accounting_monthly_store_summary
        WHERE store_id = ANY(${t.fbaStoreIds}) AND make_date(year, month, 1) < ${t.startDate}::date
        ORDER BY store_id, year DESC, month DESC
      `;
      if (!latest.length) {
        return { id: "fee_vs_actual", title: "Phí Amazon ước tính so với phí thật", status: "info", summary: "Chưa có báo cáo tháng nào để đối chiếu phí thật." };
      }
      const ref = await tx<{ store_id: string; sku: string; ym: string; est_unit: number; units: number; actual_unit: number }[]>`
        WITH asin_fees AS (
          SELECT store_id, asin, MAX(amazon_fee) AS amazon_fee, MAX(referral_fee_pct) AS referral_fee_pct
          FROM accounting_sku_master
          WHERE store_id = ANY(${t.fbaStoreIds}) AND asin IS NOT NULL AND asin <> ''
          GROUP BY store_id, asin
        ),
        cur AS (
          SELECT o.store_id, o.sku,
            SUM(CASE WHEN COALESCE(o.item_price, 0) = 0 THEN 0
              ELSE COALESCE(sm.amazon_fee, af.amazon_fee, 0) * COALESCE(o.quantity, 1)
                 + COALESCE(sm.referral_fee_pct, af.referral_fee_pct, 0) * COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)} END)::float AS est_fee,
            SUM(CASE WHEN o.amazon_order_id NOT LIKE 'S0%' AND COALESCE(o.item_price, 0) <> 0 THEN COALESCE(o.quantity, 1) ELSE 0 END)::int AS units
          FROM accounting_orders o
          LEFT JOIN asin_fees af ON af.store_id = o.store_id AND af.asin = o.asin
          LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
          WHERE o.store_id = ANY(${t.fbaStoreIds}) AND o.fulfillment_channel = 'Amazon'
            AND o.date >= ${t.startDate}::date AND o.date <= ${t.endDate}::date AND o.date < CURRENT_DATE
            AND o.currency IN ('USD', 'CAD', 'MXN')
            AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
          GROUP BY 1, 2
        )
        SELECT c.store_id, c.sku, l.ym, (c.est_fee / NULLIF(c.units, 0))::float AS est_unit, c.units,
          (-(COALESCE(sk.amazon_fee_trans, 0) + COALESCE(sk.amazon_fee_unrecognized, 0)) / NULLIF(sk.quantity, 0))::float AS actual_unit
        FROM cur c
        JOIN (VALUES ${tx.unsafe(latest.map((l) => `('${l.store_id}'::uuid, '${l.ym}')`).join(", "))}) AS l(store_id, ym) ON l.store_id = c.store_id
        JOIN accounting_sku_monthly sk ON sk.store_id = c.store_id AND sk.sku = c.sku
          AND to_char(make_date(sk.year, sk.month, 1), 'YYYY-MM') = l.ym AND sk.quantity > 0
        WHERE c.units > 0
      `;
      const all = ref.map((r) => ({ ...r, gapUnit: r.actual_unit - r.est_unit, impact: (r.actual_unit - r.est_unit) * r.units }));
      // Lệch RÒNG cả hai chiều (SKU phí thật thấp hơn Bảng mã bù trừ SKU cao hơn) — chỉ cộng một chiều sẽ phóng đại.
      const totalImpact = all.reduce((s2, g) => s2 + g.impact, 0);
      const estTotal = all.reduce((s2, g) => s2 + g.est_unit * g.units, 0);
      const gaps = all.filter((r) => r.gapUnit >= 0.3 && r.gapUnit >= r.est_unit * 0.05).sort((x, y) => y.impact - x.impact);
      const material = totalImpact >= Math.max(50, estTotal * 0.03);
      return {
        id: "fee_vs_actual",
        title: "Phí Amazon ước tính so với phí thật",
        status: material ? "warning" : gaps.length ? "info" : "ok",
        summary: material
          ? `Kỳ này chưa chốt tháng. Theo phí thật / unit tháng gần nhất, Dashboard đang tính THIẾU khoảng ${r2(totalImpact)}$ phí Amazon kỳ này (lệch ròng ${r2((totalImpact / (estTotal || 1)) * 100)}% trên ${all.length} SKU đối chiếu được); ${gaps.length} SKU có phí trong Bảng mã thấp hơn thực tế rõ rệt.`
          : gaps.length
            ? `Kỳ này chưa chốt tháng. Tổng phí ước tính gần khớp phí thật tháng gần nhất (lệch ròng ${r2(totalImpact)}$), nhưng ${gaps.length} SKU có phí trong Bảng mã thấp hơn thực tế.`
            : "Kỳ này chưa chốt tháng; phí trong Bảng mã của các SKU đang bán khớp phí thật / unit tháng gần nhất.",
        impact: material ? "Amazon Fee trên Dashboard THẤP ẢO ⇒ Profit / Margin CAO ẢO khoảng số trên. Cập nhật phí FBA / % referral của các SKU dưới đây trong Bảng mã." : gaps.length ? "Nên cập nhật phí FBA / % referral của các SKU dưới đây trong Bảng mã." : undefined,
        items: gaps.slice(0, ITEM_LIMIT).map((g) => ({
          store: t.storeName.get(g.store_id) ?? g.store_id,
          sku: g.sku,
          refMonth: g.ym,
          estPerUnit: r2(g.est_unit),
          actualPerUnit: r2(g.actual_unit),
          unitsThisPeriod: g.units,
          estimatedShortfall: r2(g.impact),
        })),
      };
    }
    const from = months.reduce((a, m) => (m.month_start < a ? m.month_start : a), months[0].month_start);
    const to = months.reduce((a, m) => (m.month_end > a ? m.month_end : a), months[0].month_end);
    // Phí ước tính từng SKU / tháng: đúng công thức Amazon Fee của listFbaDaily
    const est = await tx<{ store_id: string; ym: string; sku: string; est_fee: number; units: number }[]>`
      WITH asin_fees AS (
        SELECT store_id, asin, MAX(amazon_fee) AS amazon_fee, MAX(referral_fee_pct) AS referral_fee_pct
        FROM accounting_sku_master
        WHERE store_id = ANY(${t.fbaStoreIds}) AND asin IS NOT NULL AND asin <> ''
        GROUP BY store_id, asin
      )
      SELECT o.store_id, to_char(o.date, 'YYYY-MM') AS ym, o.sku,
        SUM(CASE WHEN COALESCE(o.item_price, 0) = 0 THEN 0
          ELSE COALESCE(sm.amazon_fee, af.amazon_fee, 0) * COALESCE(o.quantity, 1)
             + COALESCE(sm.referral_fee_pct, af.referral_fee_pct, 0) * COALESCE(o.item_price, 0) * ${tx.unsafe(FX_SQL)} END)::float AS est_fee,
        SUM(CASE WHEN o.amazon_order_id NOT LIKE 'S0%' THEN COALESCE(o.quantity, 1) ELSE 0 END)::int AS units
      FROM accounting_orders o
      LEFT JOIN asin_fees af ON af.store_id = o.store_id AND af.asin = o.asin
      LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
      WHERE o.store_id = ANY(${t.fbaStoreIds}) AND o.fulfillment_channel = 'Amazon'
        AND o.date >= ${from}::date AND o.date <= ${to}::date AND o.date < CURRENT_DATE
        AND o.currency IN ('USD', 'CAD', 'MXN')
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY 1, 2, 3
    `;
    const actualSku = await tx<{ store_id: string; ym: string; sku: string; actual: number; units: number }[]>`
      SELECT store_id, to_char(make_date(year, month, 1), 'YYYY-MM') AS ym, sku,
        (-(COALESCE(amazon_fee_trans, 0) + COALESCE(amazon_fee_unrecognized, 0)))::float AS actual,
        COALESCE(quantity, 0)::int AS units
      FROM accounting_sku_monthly
      WHERE store_id = ANY(${t.fbaStoreIds})
        AND make_date(year, month, 1) >= ${from}::date AND make_date(year, month, 1) <= ${to}::date
    `;
    const estByStoreMonth = new Map<string, number>();
    const estBySku = new Map<string, { fee: number; units: number }>();
    for (const r of est) {
      const k = `${r.store_id}|${r.ym}`;
      estByStoreMonth.set(k, (estByStoreMonth.get(k) ?? 0) + r.est_fee);
      estBySku.set(`${k}|${r.sku}`, { fee: r.est_fee, units: r.units });
    }
    const items = months
      .map((m) => {
        const k = `${m.store_id}|${m.ym}`;
        const estimated = estByStoreMonth.get(k) ?? 0;
        const gap = m.actual - estimated;
        const skus = actualSku
          .filter((a) => a.store_id === m.store_id && a.ym === m.ym && a.units > 0)
          .map((a) => {
            const e = estBySku.get(`${k}|${a.sku}`) ?? { fee: 0, units: 0 };
            return { sku: a.sku, units: a.units, estPerUnit: e.units ? e.fee / e.units : 0, actualPerUnit: a.actual / a.units, gap: a.actual - e.fee };
          })
          .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))
          .slice(0, 3)
          .filter((x) => Math.abs(x.gap) >= 20);
        return {
          store: t.storeName.get(m.store_id) ?? m.store_id,
          month: m.ym,
          estimated: r2(estimated),
          actual: r2(m.actual),
          gap: r2(gap),
          gapPct: estimated ? r2((gap / estimated) * 100) : null,
          flagged: Math.abs(gap) >= Math.max(50, Math.abs(estimated) * 0.03),
          topSkus: skus.map((x) => `${x.sku}: ước tính ${r2(x.estPerUnit)}$/unit, thật ${r2(x.actualPerUnit)}$/unit (${x.units} unit, lệch ${r2(x.gap)}$)`),
        };
      })
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const flagged = items.filter((i) => i.flagged);
    const under = flagged.filter((i) => i.gap > 0).reduce((s, i) => s + i.gap, 0);
    return {
      id: "fee_vs_actual",
      title: "Phí Amazon ước tính so với phí thật",
      status: flagged.length ? "warning" : "ok",
      summary: flagged.length
        ? `${flagged.length} store-tháng có phí Amazon trên Dashboard (ước tính theo Bảng mã) lệch phí thật trong báo cáo giao dịch quá 3%${under > 0 ? ` — tổng phí thật cao hơn ước tính ${r2(under)}$` : ""}. Lệch lớn nhất: ${flagged[0].store} tháng ${flagged[0].month} (${flagged[0].gapPct}%).`
        : `Phí Amazon ước tính khớp phí thật (lệch < 3%) ở ${items.length} store-tháng đã có báo cáo tháng.`,
      impact: flagged.length
        ? "Phí thật cao hơn ước tính ⇒ Amazon Fee trên Dashboard THẤP ẢO, Profit / Margin CAO ẢO. Thường do phí FBA / % referral của SKU trong Bảng mã đã cũ — sửa ở Bảng mã (xem topSkus)."
        : undefined,
      items: items.slice(0, ITEM_LIMIT).map((i) => ({ store: i.store, month: i.month, estimated: i.estimated, actual: i.actual, gap: i.gap, gapPct: i.gapPct, topSkus: i.topSkus })),
    };
  },

  /**
   * Chi phí CÓ trong báo cáo tháng (KQKD) nhưng Dashboard KHÔNG trừ: phí lưu kho, placement, lưu kho dài hạn,
   * phí hoàn hàng FBA, thanh lý, removal, AWD / subscription… ⇒ giải thích vì sao Profit Dashboard > Profit KQKD.
   */
  async costs_not_in_dashboard(tx, t) {
    if (!t.fbaStoreIds.length || !t.startDate) return skip("costs_not_in_dashboard", "Chi phí Dashboard chưa trừ");
    const rows = await tx<Record<string, unknown>[]>`
      SELECT m.store_id, to_char(make_date(m.year, m.month, 1), 'YYYY-MM') AS month,
        (-COALESCE(m.total_storage_fee, 0))::float AS storage_fee,
        (-COALESCE(m.total_placement_fee, 0))::float AS placement_fee,
        (-COALESCE(m.total_long_term_fee, 0))::float AS long_term_fee,
        (-COALESCE(m.total_fba_customer_return_fee, 0))::float AS fba_return_fee,
        (-COALESCE(m.total_removal, 0))::float AS removal,
        (-COALESCE(m.total_liquidations, 0))::float AS liquidations,
        (-COALESCE(m.awd_subscription_fees, 0))::float AS awd_subscription,
        (-COALESCE(m.total_adjustment, 0))::float AS adjustment
      FROM accounting_monthly_store_summary m
      WHERE m.store_id = ANY(${t.fbaStoreIds})
        AND make_date(m.year, m.month, 1) <= ${t.endDate}::date
        AND (make_date(m.year, m.month, 1) + interval '1 month - 1 day')::date >= ${t.startDate}::date
      ORDER BY 2 DESC
      LIMIT 24
    `;
    const labels: Record<string, string> = {
      storage_fee: "lưu kho", placement_fee: "placement", long_term_fee: "lưu kho dài hạn", fba_return_fee: "phí hoàn hàng FBA",
      removal: "removal", liquidations: "thanh lý", awd_subscription: "AWD / subscription", adjustment: "điều chỉnh (âm = được hoàn)",
    };
    const items = rows.map((r) => {
      const parts = Object.keys(labels).filter((k) => Math.abs(Number(r[k])) >= 1);
      const total = parts.reduce((s, k) => s + Number(r[k]), 0);
      return {
        store: t.storeName.get(String(r.store_id)) ?? r.store_id,
        month: r.month,
        total: r2(total),
        breakdown: parts.map((k) => `${labels[k]} ${r2(r[k])}$`).join(", "),
      };
    });
    const total = items.reduce((s, i) => s + i.total, 0);
    if (!items.length) {
      return { id: "costs_not_in_dashboard", title: "Chi phí Dashboard chưa trừ", status: "info", summary: "Kỳ này chưa có báo cáo tháng để biết chi phí lưu kho / placement… (thường có sau khi chốt tháng)." };
    }
    return {
      id: "costs_not_in_dashboard",
      title: "Chi phí Dashboard chưa trừ",
      status: Math.abs(total) >= 1 ? "info" : "ok",
      summary: `Báo cáo tháng có ${r2(total)}$ chi phí (lưu kho, placement, lưu kho dài hạn, hoàn hàng FBA…) ở ${items.length} store-tháng mà P&L trên Dashboard KHÔNG trừ.`,
      impact: "Profit trên Dashboard CAO HƠN Profit báo cáo tháng (KQKD / SKU monthly) đúng bằng khoản này — khác biệt theo thiết kế, không phải lỗi nhập liệu.",
      items: items.slice(0, ITEM_LIMIT),
    };
  },

  /** Giá vốn tháng của SKU đang bán lệch > 50% so với trung bình 3 tháng trước — dễ là nhập nhầm. */
  async basecost_outlier(tx, t) {
    if (!t.fbaStoreIds.length || !t.startDate) return skip("basecost_outlier", "Giá vốn biến động bất thường");
    const rows = await tx`
      WITH sold AS (
        SELECT DISTINCT o.store_id, o.sku, to_char(o.date, 'YYYY-MM') AS period
        FROM accounting_orders o
        WHERE o.store_id = ANY(${t.fbaStoreIds}) AND o.fulfillment_channel = 'Amazon'
          AND o.date >= ${t.startDate}::date AND o.date <= ${t.endDate}::date AND o.date < CURRENT_DATE
          AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      ),
      b AS (
        SELECT store_id, sku, period, basecost_thang::float AS v
        FROM accounting_monthly_base_cost
        WHERE store_id = ANY(${t.fbaStoreIds}) AND deleted_at IS NULL AND basecost_thang > 0
      )
      SELECT b.store_id, b.sku, b.period AS month, ROUND(b.v::numeric, 2)::float AS basecost,
        ROUND(p.avg::numeric, 2)::float AS prev_avg, ROUND(((b.v - p.avg) / p.avg * 100)::numeric, 1)::float AS change_pct
      FROM b
      JOIN sold s ON s.store_id = b.store_id AND s.sku = b.sku AND s.period = b.period
      JOIN LATERAL (
        SELECT AVG(b2.v) AS avg, COUNT(*) AS n FROM b b2
        WHERE b2.store_id = b.store_id AND b2.sku = b.sku AND b2.period < b.period
          AND b2.period >= to_char(to_date(b.period, 'YYYY-MM') - interval '3 months', 'YYYY-MM')
      ) p ON p.n >= 1
      WHERE (b.v > 1.5 * p.avg OR b.v < 0.5 * p.avg) AND ABS(b.v - p.avg) >= 1
      ORDER BY ABS(b.v - p.avg) DESC
      LIMIT 100
    `;
    return {
      id: "basecost_outlier",
      title: "Giá vốn biến động bất thường",
      status: rows.length ? "warning" : "ok",
      summary: rows.length
        ? `${rows.length} SKU đang bán có BASECOST THÁNG lệch hơn 50% so với trung bình 3 tháng trước — cần xác nhận là giá nhập đổi thật hay nhập nhầm.`
        : "Giá vốn tháng của các SKU đang bán không biến động bất thường.",
      impact: rows.length ? "Nếu nhập nhầm: Base cost sai ⇒ Profit / Margin / ROI sai theo (giá vốn cao ⇒ lãi thấp ảo, thấp ⇒ lãi cao ảo)." : undefined,
      items: withStore(t, rows.slice(0, ITEM_LIMIT)),
    };
  },

  /**
   * Ngày bất thường so với 14 ngày trước đó (trung vị): số đơn / tiền ADS TỤT mạnh thường là thiếu file import
   * (cảnh báo); TĂNG vọt có thể là bán chạy thật hoặc import trùng (lưu ý). Không tính hôm nay.
   */
  async daily_anomaly(tx, t) {
    const ids = [...new Set([...t.fbaStoreIds, ...t.fbmStoreIds])];
    if (!ids.length || !t.startDate) return skip("daily_anomaly", "Ngày có số liệu bất thường");
    const rows = await tx<{ store_id: string; kind: string; date: string; value: number; median: number }[]>`
      WITH od AS (
        SELECT store_id, date, COUNT(DISTINCT amazon_order_id)::float AS v
        FROM accounting_orders
        WHERE store_id = ANY(${ids}) AND date >= ${t.startDate}::date - 14 AND date <= ${t.endDate}::date AND date < CURRENT_DATE
          AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
        GROUP BY 1, 2
      ),
      ad AS (
        SELECT store_id, date, SUM(COALESCE(spend, 0))::float AS v
        FROM accounting_ads
        WHERE store_id = ANY(${ids}) AND date >= ${t.startDate}::date - 14 AND date <= ${t.endDate}::date AND date < CURRENT_DATE
        GROUP BY 1, 2
      ),
      series AS (
        SELECT 'orders' AS kind, store_id, date, v FROM od
        UNION ALL SELECT 'ads', store_id, date, v FROM ad
      ),
      scored AS (
        SELECT s.kind, s.store_id, s.date, s.v,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s2.v) FROM series s2
            WHERE s2.kind = s.kind AND s2.store_id = s.store_id AND s2.date BETWEEN s.date - 14 AND s.date - 1) AS med
        FROM series s
        WHERE s.date >= ${t.startDate}::date
      )
      SELECT store_id, kind, date::text, ROUND(v::numeric, 2)::float AS value, ROUND(med::numeric, 2)::float AS median
      FROM scored
      WHERE (kind = 'orders' AND med >= 5 AND (v < 0.4 * med OR v > 2.5 * med))
         OR (kind = 'ads' AND med >= 20 AND (v < 0.3 * med OR v > 3 * med))
      ORDER BY date DESC
      LIMIT 60
    `;
    const items = rows.map((r) => {
      const drop = r.value < r.median;
      return {
        store: t.storeName.get(r.store_id) ?? r.store_id,
        date: r.date,
        type: `${r.kind === "orders" ? "Số đơn" : "Tiền ADS"} ${drop ? "TỤT" : "tăng vọt"}`,
        value: r.value,
        median14d: r.median,
        drop,
      };
    });
    const drops = items.filter((i) => i.drop);
    return {
      id: "daily_anomaly",
      title: "Ngày có số liệu bất thường",
      status: drops.length ? "warning" : items.length ? "info" : "ok",
      summary: items.length
        ? `${drops.length} ngày-store số đơn / tiền ADS tụt mạnh so với 14 ngày trước${items.length - drops.length ? `, ${items.length - drops.length} ngày tăng vọt` : ""}.`
        : "Không có ngày nào số đơn / tiền ADS lệch bất thường so với 14 ngày trước.",
      impact: drops.length
        ? "Ngày tụt mạnh thường do thiếu file Orders / ADS của ngày đó ⇒ Revenue / Ad Spend THẤP hơn thực tế. Ngày tăng vọt: kiểm tra là bán chạy thật hay import trùng."
        : items.length
          ? "Ngày tăng vọt có thể là bán chạy thật (khuyến mãi) hoặc import trùng — nên xác nhận."
          : undefined,
      items: [...drops, ...items.filter((i) => !i.drop)].slice(0, ITEM_LIMIT).map((i) => ({ store: i.store, date: i.date, type: i.type, value: i.value, median14d: i.median14d })),
    };
  },
};

function skip(id: string, title: string): DataCheckResult {
  return { id, title, status: "info", summary: "Không áp dụng cho phạm vi này (không có kênh / kỳ phù hợp)." };
}

/** Chạy các kiểm tra (mặc định: tất cả) cho phạm vi của snapshot; storeId để thu hẹp về 1 store. */
export async function runAccountingChecks(
  snapshot: PnlSnapshot,
  options: { checks?: string[]; storeId?: string } = {},
): Promise<DataCheckResult[]> {
  const ids = (options.checks?.length ? options.checks : ACCOUNTING_CHECK_IDS).filter((id): id is AccountingCheckId =>
    (ACCOUNTING_CHECK_IDS as readonly string[]).includes(id),
  );
  const target = targetsOf(snapshot, options.storeId);
  return withAgentReadOnly(async (tx) => {
    const results: DataCheckResult[] = [];
    // Tuần tự trong 1 transaction (1 kết nối) — tránh chiếm nhiều kết nối DB cùng lúc. Mỗi kiểm tra chạy trong
    // savepoint: 1 kiểm tra lỗi / quá thời gian không làm hỏng cả transaction của các kiểm tra sau.
    for (const id of ids) {
      try {
        results.push(await tx.savepoint((sp) => RUNNERS[id](sp, target, snapshot)) as DataCheckResult);
      } catch (error) {
        results.push({
          id,
          title: id,
          status: "info",
          summary: `Không chạy được kiểm tra: ${error instanceof Error ? error.message : "lỗi"}`,
        });
      }
    }
    return results;
  });
}
