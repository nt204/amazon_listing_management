"""
SKU FBM-monthly của 1 kỳ từ file thô Amazon (cùng thư mục crawler / R2 với FBA) + DB:
  - SKU: BẢNG MÃ FBM (accounting_sku_master_fbm, Loại FBM) — % Referal, Total cost (basecost khi thiếu Printway)
  - Basecost đơn: ĐẦU VÀO PRINTWAY (accounting_fbm_pw_costs) — tổng NetPrice của Order ID, ghi vào dòng đầu của đơn
dựng lại các dòng Basecost / Trans Rp / Ads giống file TỔNG KẾT rồi tính bằng fbm_monthly_engine.

Tab Basecost (dòng đơn tháng M, theo file 02_AllOrders):
  L Sales     = (item-price + shipping-price) × tỷ giá; đơn Cancelled = 0
  M Quantity  = quantity (bỏ đơn removal S01- / Non-Amazon)
  P Amazon fee total = -(Sales × % Referal)            (FBM không có phí FBA)
  Q Thuế      = đơn đã có trong Trans Rp: -1% Sales; chưa: -(Sales × %Referal × 10% + 1% Sales)
  U Basecost  = -(Printway của đơn) ở dòng đầu của Order ID, Printway = 0 thì -(quantity × Total cost); dòng sau = 0
  X           = "Ghi nhận" nếu Order ID có giao dịch Order trong Trans Rp (file tháng M + 3 tháng sau)
Trans Rp: phí Amazon của đơn tháng M (mọi file, theo tháng đặt đơn); Refund / A-to-z / Chargeback theo file tháng M.
"""
import csv
import os
import re
from collections import defaultdict

from fbm_monthly_engine import FBM_OWNER_FEE_STORES, compute_fbm_month, dedupe_rows, summarize

CURRENCY_RATES = {'USD': 1.0, 'CAD': 0.738, 'MXN': 0.056}


def load_fbm_catalog(conn, store_id):
    cur = conn.cursor()
    cur.execute("""
        SELECT sku, asin, product_type, status, referral_fee_pct, total_cost
        FROM accounting_sku_master_fbm
        WHERE store_id = %s AND deleted_at IS NULL AND COALESCE(TRIM(sku), '') <> ''
          AND UPPER(TRIM(COALESCE(loai, 'FBM'))) = 'FBM'
        ORDER BY row_order NULLS LAST, created_at
    """, (store_id,))
    skus, referral, cost = [], {}, {}
    for sku, asin, product_type, status, pct, total_cost in cur.fetchall():
        k = sku.strip().upper()
        skus.append({'sku': sku.strip(), 'asin': (asin or '').strip() or None, 'product_type': product_type,
                     'status': status})
        referral.setdefault(k, float(pct) if pct is not None else 0.15)
        cost.setdefault(k, float(total_cost or 0))
    return skus, referral, cost


def load_pw_costs(conn, store_id, order_ids):
    if not order_ids:
        return {}
    cur = conn.cursor()
    cur.execute("""
        SELECT order_id, SUM(COALESCE(net_price, 0))::float
        FROM accounting_fbm_pw_costs
        WHERE store_id = %s AND order_id = ANY(%s)
        GROUP BY order_id
    """, (store_id, list(order_ids)))
    return dict(cur.fetchall())


def ads_tax_rate(conn, store_id):
    cur = conn.cursor()
    cur.execute("SELECT fbm_ads_tax_rate::float FROM stores WHERE id = %s", (store_id,))
    row = cur.fetchone()
    return row[0] if row and row[0] is not None else 0.1


def _f(v):
    try:
        return float(str(v or '').replace(',', '').strip() or 0)
    except ValueError:
        return 0.0


def read_orders(orders_file):
    with open(orders_file, 'r', encoding='utf-8', errors='replace') as f:
        return [r for r in csv.DictReader(f, delimiter='\t')
                if not r.get('amazon-order-id', '').startswith('S01-') and r.get('sales-channel', '').strip() != 'Non-Amazon']


def trans_order_fee(row):
    total, sales, ship = _f(row.get('total')), _f(row.get('product sales')), _f(row.get('shipping credits'))
    return (total - sales - ship) if row.get('fulfillment', '').strip() == 'Seller' else (total - sales)


def build_trans_rows(trans_file, later_files, month, month_order_ids, read_transaction_rows):
    rows, settled = [], set()
    for path, is_current in [(trans_file, True)] + [(p, False) for p in later_files]:
        for r in read_transaction_rows(path) or []:
            ttype = r.get('type', '').strip()
            oid = r.get('order id', '').strip()
            in_month = oid in month_order_ids
            if ttype == 'Order' and in_month:
                settled.add(oid)
            if not is_current and not (ttype == 'Order' and in_month):
                continue
            rows.append({
                'type': ttype,
                'sku': r.get('sku', '').strip(),
                'total': _f(r.get('total')),
                'month': month if is_current else None,
                'order_month': month if in_month else None,
                'order_fee': trans_order_fee(r) if ttype == 'Order' else 0.0,
            })
    return rows, settled


def build_basecost_rows(orders, month, referral, cost, pw, settled):
    rows, seen_orders = [], set()
    for r in orders:
        oid = r.get('amazon-order-id', '').strip()
        sku = r.get('sku', '').strip()
        k = sku.upper()
        currency = r.get('currency', '').strip()
        price, ship = _f(r.get('item-price')), _f(r.get('shipping-price'))
        qty = _f(r.get('quantity'))
        merchant = r.get('fulfillment-channel', '').strip() == 'Merchant'
        cancelled = r.get('order-status', '').strip() == 'Cancelled'
        sales = 0.0 if cancelled else ((price + ship) if merchant else price) * CURRENCY_RATES.get(currency or 'USD', 0.0)
        pct = referral.get(k, 0.15)
        ghi_nhan = oid in settled
        first = oid not in seen_orders
        seen_orders.add(oid)
        if first:
            order_pw = pw.get(oid, 0.0)
            basecost = -(order_pw if order_pw else qty * cost.get(k, 0.0))
        else:
            basecost = 0.0
        rows.append({
            'month': month, 'sku': sku, 'sales': sales, 'qty': qty,
            'amz_fee': -(sales * pct) if (currency and price != 0) else 0.0,
            'tax': -(sales * 0.01) if ghi_nhan else -(sales * pct * 0.10 + sales * 0.01),
            'basecost': basecost,
            'trans_status': 'ghi nhận' if ghi_nhan else 'chưa ghi nhận',
        })
    return rows


def build_ads_rows(ads_file, month, fbm_keys, tax_rate):
    """File 01_Portfolios: gắn SKU bằng mã SKU FBM có trong tên portfolio (token cuối trùng mã)."""
    rows = []
    if not ads_file or not os.path.exists(ads_file):
        return rows
    with open(ads_file, 'r', encoding='utf-8-sig', errors='replace') as f:
        for r in csv.DictReader(f):
            name = (r.get('Portfolio') or r.get('Portfolio name') or '').strip()
            if not name:
                continue
            sku = None
            for token in reversed(re.findall(r'[A-Za-z0-9_-]+', name)):
                if token.upper() in fbm_keys:
                    sku = fbm_keys[token.upper()]
                    break
            spend = _f(r.get('Spend(USD)') or r.get('Spend'))
            rows.append({'month': month, 'portfolio': name, 'spend': spend if sku else 0.0,
                         'sales': _f(r.get('Sales(USD)') or r.get('Sales')), 'sku': sku, 'tax': spend * tax_rate if sku else 0.0})
    return rows


def compute_fbm_from_raw(conn, store_id, store_name, year, month, orders_file, trans_file, later_trans_files, ads_file,
                         read_transaction_rows):
    skus, referral, cost = load_fbm_catalog(conn, store_id)
    if not skus:
        return None
    orders = read_orders(orders_file)
    month_order_ids = {r.get('amazon-order-id', '').strip() for r in orders if r.get('order-status', '').strip() != 'Cancelled'}
    trans_rows, settled = build_trans_rows(trans_file, later_trans_files, month, month_order_ids, read_transaction_rows)
    pw = load_pw_costs(conn, store_id, {r.get('amazon-order-id', '').strip() for r in orders})
    basecost_rows = build_basecost_rows(orders, month, referral, cost, pw, settled)
    fbm_keys = {s['sku'].upper(): s['sku'] for s in skus}
    ads_rows = build_ads_rows(ads_file, month, fbm_keys, ads_tax_rate(conn, store_id))
    owner_fee = (store_name or '').strip().upper() in FBM_OWNER_FEE_STORES
    rows, _ = compute_fbm_month(skus, basecost_rows, trans_rows, ads_rows, month, owner_fee)
    rows, dropped = dedupe_rows(rows)
    return rows, summarize(rows, month, owner_fee), dropped
