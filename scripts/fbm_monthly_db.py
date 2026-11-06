"""Ghi SKU FBM-monthly của 1 kỳ vào accounting_fbm_sku_monthly + accounting_fbm_monthly_store_summary (migration 135)."""
from psycopg2.extras import execute_values

from fbm_monthly_engine import ratios


def upsert_fbm_month(conn, store_id, year, month, rows, summary, data_source=None):
    """Thay toàn bộ dòng sản phẩm (SKU + ASIN) của kỳ và tổng của store. Không commit."""
    cur = conn.cursor()
    # Sản phẩm (SKU + ASIN) không còn trong bảng mã thì xóa khỏi kỳ
    keys = [f"{r['sku']}\x1f{r.get('asin') or ''}" for r in rows]
    cur.execute("""
        DELETE FROM accounting_fbm_sku_monthly
        WHERE store_id = %s AND year = %s AND month = %s AND NOT ((sku || chr(31) || asin) = ANY(%s))
    """, (store_id, year, month, keys))
    values = []
    for r in rows:
        x = ratios(r)
        values.append((
            store_id, year, month, r['sku'], r.get('asin') or '', r.get('product_type'), r.get('status'),
            r['revenue'], round(r['quantity']), r['ads_fee'], r['basecost'], r['amazon_fee_unrecognized'],
            r['amazon_fee_trans'], r['thue'], r['return_amount'], r['a_to_z_claim'], r['chargeback_refund'],
            r['profit'], r['revenue_ads'], x['tacos'], x['acos'], x['margin'], x['roi'], x['profit_per_item'],
            x['basecost_per_item'],
        ))
    if values:
        execute_values(cur, """
            INSERT INTO accounting_fbm_sku_monthly (
              store_id, year, month, sku, asin, product_type, status,
              revenue, quantity, ads_fee, basecost, amazon_fee_unrecognized,
              amazon_fee_trans, thue, return_amount, a_to_z_claim, chargeback_refund,
              profit, revenue_ads, tacos, acos, margin, roi, profit_per_item, basecost_per_item
            ) VALUES %s
            ON CONFLICT (store_id, year, month, sku, asin) DO UPDATE SET
              product_type = EXCLUDED.product_type, status = EXCLUDED.status,
              revenue = EXCLUDED.revenue, quantity = EXCLUDED.quantity, ads_fee = EXCLUDED.ads_fee,
              basecost = EXCLUDED.basecost, amazon_fee_unrecognized = EXCLUDED.amazon_fee_unrecognized,
              amazon_fee_trans = EXCLUDED.amazon_fee_trans, thue = EXCLUDED.thue,
              return_amount = EXCLUDED.return_amount, a_to_z_claim = EXCLUDED.a_to_z_claim,
              chargeback_refund = EXCLUDED.chargeback_refund, profit = EXCLUDED.profit,
              revenue_ads = EXCLUDED.revenue_ads, tacos = EXCLUDED.tacos, acos = EXCLUDED.acos,
              margin = EXCLUDED.margin, roi = EXCLUDED.roi, profit_per_item = EXCLUDED.profit_per_item,
              basecost_per_item = EXCLUDED.basecost_per_item, updated_at = NOW()
        """, values, page_size=1000)

    s = summary
    rev, profit, ads, bc = s['revenue'], s['net_profit'], s['ads_fee'], s['basecost']
    cur.execute("""
        INSERT INTO accounting_fbm_monthly_store_summary (
          store_id, year, month, total_revenue, total_quantity, total_ads_fee, total_basecost,
          total_amazon_fee_unrecognized, total_amazon_fee_trans, total_thue, total_return_amount,
          total_a_to_z_claim, total_chargeback_refund, total_sku_profit, owner_fee, net_profit,
          total_revenue_ads, tacos, acos, margin, roi, active_sku_count, total_sku_count, data_source
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (store_id, year, month) DO UPDATE SET
          total_revenue = EXCLUDED.total_revenue, total_quantity = EXCLUDED.total_quantity,
          total_ads_fee = EXCLUDED.total_ads_fee, total_basecost = EXCLUDED.total_basecost,
          total_amazon_fee_unrecognized = EXCLUDED.total_amazon_fee_unrecognized,
          total_amazon_fee_trans = EXCLUDED.total_amazon_fee_trans, total_thue = EXCLUDED.total_thue,
          total_return_amount = EXCLUDED.total_return_amount, total_a_to_z_claim = EXCLUDED.total_a_to_z_claim,
          total_chargeback_refund = EXCLUDED.total_chargeback_refund, total_sku_profit = EXCLUDED.total_sku_profit,
          owner_fee = EXCLUDED.owner_fee, net_profit = EXCLUDED.net_profit,
          total_revenue_ads = EXCLUDED.total_revenue_ads, tacos = EXCLUDED.tacos, acos = EXCLUDED.acos,
          margin = EXCLUDED.margin, roi = EXCLUDED.roi, active_sku_count = EXCLUDED.active_sku_count,
          total_sku_count = EXCLUDED.total_sku_count, data_source = EXCLUDED.data_source, updated_at = NOW()
    """, (
        store_id, year, month, rev, round(s['quantity']), ads, bc, s['amazon_fee_unrecognized'],
        s['amazon_fee_trans'], s['thue'], s['return_amount'], s['a_to_z_claim'], s['chargeback_refund'],
        s['profit'], s['owner_fee'], profit, s['revenue_ads'],
        ads / rev if rev else None,
        ads / s['revenue_ads'] if s['revenue_ads'] else None,
        profit / rev if rev else None,
        profit / bc if bc else None,
        s['active_sku_count'], s['total_sku_count'], data_source,
    ))
