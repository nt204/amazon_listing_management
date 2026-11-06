"""
Công thức tab "SKU FBM-monthly" của file TỔNG KẾT CUỐI THÁNG (dòng 4 trở đi, khoảng tháng C1..E1 = 1 tháng):

  C  SKU        = FILTER('BẢNG MÃ'!D, 'BẢNG MÃ'!A = store, 'BẢNG MÃ'!J = "FBM")
  E  Revenue    = SUMIFS(Basecost!L, Month, SKU)
  F  Quantity   = SUMIFS(Basecost!M, Month, SKU)
  G  Ads Fee    = -SUMIFS(Ads!L, Ads!X = SKU, Month)
  H  Basecost   = SUMIFS(Basecost!U, Month, SKU)
  I  Amazon Fee (chưa ghi nhận) = SUMIFS(Basecost!P, Month, SKU, Basecost!X = "Chưa ghi nhận")
  J  Amazon fee (transperance)  = SUMIFS('Trans Rp'!AM, 'Trans Rp'!AI = tháng đặt đơn, SKU, type "Order")
  K  Thuế       = -SUMIFS(Ads!AD, SKU, Month) + SUMIFS(Basecost!Q, Month, SKU)
  L  Return     = SUMIFS('Trans Rp'!AD, 'Trans Rp'!AE = tháng giao dịch, type "Refund", SKU)
  M  A-to-z Guarantee Claim / N Chargeback Refund: như L với type tương ứng
  O  Profit     = E + SUM(G:N)
  AD Revenue ads = SUMIFS(Ads!O, Ads!B LIKE "*SKU*", Month)
  Ô O2 (store)  = SUM(O) + V2, V2 = phí chủ store -IF(tháng>=9, IF(Revenue>20000, 0.5%·Revenue, 1.000.000 VND/25.000))
                  — chỉ store có ô V2 (FASTPEACE); MALFIRST không cộng.

Dùng chung cho 2 nguồn: tab thô của Google Sheet (load_fbm_monthly_from_sheet.py, tháng 1–8) và file thô Amazon
(ingest_monthly_from_raw.py, tháng 9 trở đi) — mỗi nguồn tự dựng các dòng Basecost / Trans Rp / Ads tương đương.
compute_fbm_month = đúng công thức tab (để đối chiếu); compute_fbm_products = số lưu DB, tách SKU theo ASIN.
SUMIFS không phân biệt hoa thường và so khớp nguyên văn (kể cả ký tự \\r) nên khóa = UPPER, không TRIM.
"""
from collections import defaultdict

OWNER_FEE_RATE = 0.005
OWNER_FEE_THRESHOLD = 20000.0
OWNER_FEE_MIN_VND = 1_000_000
USD_VND_RATE = 25000.0
# Store mà ô Profit tổng của tab SKU FBM-monthly cộng phí chủ store (ô V2)
FBM_OWNER_FEE_STORES = {'FASTPEACE'}


def num(v):
    if v is None or v == '' or isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(',', '').strip())
    except ValueError:
        return 0.0


def key(v):
    return '' if v is None else str(v).upper()


def month_of(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def compute_fbm_month(skus, basecost_rows, trans_rows, ads_rows, month, owner_fee=False):
    """
    skus: [{'sku', 'asin', 'product_type', 'status'}] theo thứ tự BẢNG MÃ (giữ nguyên chuỗi gốc)
    basecost_rows: [{'month', 'sku', 'sales', 'qty', 'amz_fee', 'tax', 'basecost', 'trans_status'}]
    trans_rows: [{'type', 'sku', 'total', 'month', 'order_month', 'order_fee'}]
    ads_rows: [{'month', 'portfolio', 'spend', 'sales', 'sku', 'tax'}]
    Trả về (rows, summary): rows theo thứ tự skus, mỗi dòng đủ cột; summary gồm tổng và phí chủ store.
    """
    by_sku = defaultdict(lambda: defaultdict(float))
    for r in basecost_rows:
        if r['month'] != month:
            continue
        k = by_sku[key(r['sku'])]
        k['revenue'] += r['sales']
        k['quantity'] += r['qty']
        k['basecost'] += r['basecost']
        k['tax_order'] += r['tax']
        if r['trans_status'] == 'chưa ghi nhận':
            k['amazon_fee_unrecognized'] += r['amz_fee']
    for r in trans_rows:
        k = by_sku[key(r['sku'])]
        if r['type'] == 'Order' and r['order_month'] == month:
            k['amazon_fee_trans'] += r['order_fee']
        if r['month'] == month:
            if r['type'] == 'Refund':
                k['return_amount'] += r['total']
            elif r['type'] == 'A-to-z Guarantee Claim':
                k['a_to_z_claim'] += r['total']
            elif r['type'] == 'Chargeback Refund':
                k['chargeback_refund'] += r['total']
    month_ads = [r for r in ads_rows if r['month'] == month]
    for r in month_ads:
        k = by_sku[key(r['sku'])]
        k['ads_fee'] -= r['spend']
        k['ads_tax'] += r['tax']

    rows = []
    for s in skus:
        sku = s['sku']
        if sku is None or str(sku) == '':
            continue
        k = by_sku.get(key(sku), {})
        g = lambda name: k.get(name, 0.0) if k else 0.0
        upper = key(sku)
        revenue_ads = sum(r['sales'] for r in month_ads if upper in key(r['portfolio']))
        row = {
            'sku': sku,
            'asin': s.get('asin'),
            'product_type': s.get('product_type'),
            'status': s.get('status'),
            'revenue': g('revenue'),
            'quantity': g('quantity'),
            'ads_fee': g('ads_fee'),
            'basecost': g('basecost'),
            'amazon_fee_unrecognized': g('amazon_fee_unrecognized'),
            'amazon_fee_trans': g('amazon_fee_trans'),
            'thue': -g('ads_tax') + g('tax_order'),
            'return_amount': g('return_amount'),
            'a_to_z_claim': g('a_to_z_claim'),
            'chargeback_refund': g('chargeback_refund'),
            'revenue_ads': revenue_ads,
        }
        row['profit'] = row['revenue'] + sum(row[c] for c in (
            'ads_fee', 'basecost', 'amazon_fee_unrecognized', 'amazon_fee_trans', 'thue',
            'return_amount', 'a_to_z_claim', 'chargeback_refund'))
        rows.append(row)

    summary = summarize(rows, month, owner_fee)
    return rows, summary


SUM_COLS = ('revenue', 'quantity', 'ads_fee', 'basecost', 'amazon_fee_unrecognized', 'amazon_fee_trans', 'thue',
            'return_amount', 'a_to_z_claim', 'chargeback_refund', 'profit', 'revenue_ads')


def summarize(rows, month, owner_fee):
    tot = {c: sum(r[c] for r in rows) for c in SUM_COLS}
    fee = 0.0
    if owner_fee and month >= 9:
        fee = -(tot['revenue'] * OWNER_FEE_RATE if tot['revenue'] > OWNER_FEE_THRESHOLD
                else OWNER_FEE_MIN_VND / USD_VND_RATE)
    tot['owner_fee'] = fee
    tot['net_profit'] = tot['profit'] + fee
    tot['active_sku_count'] = sum(1 for r in rows if r['revenue'] or r['quantity'] or r['ads_fee'] or r['profit'])
    tot['total_sku_count'] = len(rows)
    return tot


def _clean(v):
    return '' if v is None else str(v).strip().upper()


def compute_fbm_products(skus, basecost_rows, trans_rows, ads_rows, month, owner_fee=False):
    """
    Số lưu DB: mỗi sản phẩm = 1 cặp SKU + ASIN của BẢNG MÃ (cùng SKU khác ASIN là 2 sản phẩm; dòng trùng cả SKU lẫn
    ASIN — kể cả dính ký tự \r — gộp làm 1). Khác tab sheet (SUMIFS chỉ theo SKU nên SKU 2 ASIN bị cộng 2 lần):
      - dòng đơn (Basecost) theo SKU + ASIN của đơn; ASIN không có trong bảng mã → sản phẩm đầu tiên của SKU
      - Trans Rp theo Order ID → sản phẩm của đơn; không có đơn → sản phẩm đầu tiên của SKU
      - Ads, Revenue ads (chỉ biết SKU) → sản phẩm đầu tiên của SKU
    basecost_rows cần thêm 'asin', 'order_id'; trans_rows cần thêm 'order_id'.
    """
    products, first_of_sku = {}, {}
    for s in skus:
        sku_k, asin_k = _clean(s['sku']), _clean(s.get('asin'))
        if not sku_k or (sku_k, asin_k) in products:
            continue
        products[(sku_k, asin_k)] = {
            'sku': str(s['sku']).strip(), 'asin': str(s['asin']).strip() if s.get('asin') else None,
            'product_type': s.get('product_type'), 'status': s.get('status'),
        }
        first_of_sku.setdefault(sku_k, (sku_k, asin_k))

    acc = defaultdict(lambda: defaultdict(float))
    order_product = {}

    def product_of(sku, asin=None):
        sku_k = _clean(sku)
        pk = (sku_k, _clean(asin))
        return pk if pk in products else first_of_sku.get(sku_k)

    for r in basecost_rows:
        pk = product_of(r['sku'], r.get('asin'))
        if pk is None:
            continue
        if r.get('order_id'):
            order_product.setdefault((r['order_id'], pk[0]), pk)
        if r['month'] != month:
            continue
        a = acc[pk]
        a['revenue'] += r['sales']
        a['quantity'] += r['qty']
        a['basecost'] += r['basecost']
        a['tax_order'] += r['tax']
        if r['trans_status'] == 'chưa ghi nhận':
            a['amazon_fee_unrecognized'] += r['amz_fee']
    for r in trans_rows:
        pk = order_product.get((r.get('order_id'), _clean(r['sku']))) or first_of_sku.get(_clean(r['sku']))
        if pk is None:
            continue
        a = acc[pk]
        if r['type'] == 'Order' and r['order_month'] == month:
            a['amazon_fee_trans'] += r['order_fee']
        if r['month'] == month:
            if r['type'] == 'Refund':
                a['return_amount'] += r['total']
            elif r['type'] == 'A-to-z Guarantee Claim':
                a['a_to_z_claim'] += r['total']
            elif r['type'] == 'Chargeback Refund':
                a['chargeback_refund'] += r['total']
    month_ads = [r for r in ads_rows if r['month'] == month]
    for r in month_ads:
        pk = first_of_sku.get(_clean(r['sku']))
        if pk is not None:
            acc[pk]['ads_fee'] -= r['spend']
            acc[pk]['ads_tax'] += r['tax']
    for sku_k, pk in first_of_sku.items():
        acc[pk]['revenue_ads'] = sum(r['sales'] for r in month_ads if sku_k in _clean(r['portfolio']))

    rows = []
    for pk, info in products.items():
        a = acc.get(pk, {})
        g = lambda name: a.get(name, 0.0)
        row = {
            **info,
            'revenue': g('revenue'), 'quantity': g('quantity'), 'ads_fee': g('ads_fee'), 'basecost': g('basecost'),
            'amazon_fee_unrecognized': g('amazon_fee_unrecognized'), 'amazon_fee_trans': g('amazon_fee_trans'),
            'thue': -g('ads_tax') + g('tax_order'), 'return_amount': g('return_amount'),
            'a_to_z_claim': g('a_to_z_claim'), 'chargeback_refund': g('chargeback_refund'),
            'revenue_ads': g('revenue_ads'),
        }
        row['profit'] = row['revenue'] + sum(row[c] for c in (
            'ads_fee', 'basecost', 'amazon_fee_unrecognized', 'amazon_fee_trans', 'thue',
            'return_amount', 'a_to_z_claim', 'chargeback_refund'))
        rows.append(row)
    return rows, summarize(rows, month, owner_fee)


def ratios(row):
    # Như tab SKU FBM-monthly: TAcos = G/E, Acos = G/AD, Magin = O/E, ROI = O/H, Profit/item = O/F, Basecost/Item = H/F
    rev, qty, ads, profit, bc = row['revenue'], row['quantity'], row['ads_fee'], row['profit'], row['basecost']
    return {
        'tacos': ads / rev if rev else None,
        'acos': ads / row['revenue_ads'] if row['revenue_ads'] else None,
        'margin': profit / rev if rev else None,
        'roi': profit / bc if bc else None,
        'profit_per_item': profit / qty if qty else None,
        'basecost_per_item': bc / qty if qty else None,
    }
