#!/usr/bin/env python3
"""
ingest_monthly_from_raw.py
Production Monthly Accounting Pipeline:
Reads directly from raw crawler downloads (CSV/TSV), calculates complete P&L per SKU and Store,
and upserts into PostgreSQL tables: accounting_sku_monthly and accounting_monthly_store_summary.

Safety & Cleanliness:
- Strict SKU mapping (no garbage SKUs from portfolio names like GROUP, RESERVE, RUNNING).
- Month-lagged Storage Fee: Period M reads file 14 with month_of_charge = M-1 (from previous month downloads or fallback).
- Protection lock: will not overwrite existing finalized month unless --force is specified.
- ROI is stored as negative ratio matching Excel Row 2 formula (=iferror(U2/H2,"")).
"""

import os
import sys
import csv
import re
import argparse
import psycopg2
from collections import defaultdict
from decimal import Decimal

DEFAULT_DB_URL = "postgresql://listing_desk:listing_desk@localhost:2412/listing_desk"
DEFAULT_DOWNLOAD_ROOT = os.path.expanduser("~/AmazonAccounting/downloads")

CURRENCY_RATES = {
    'USD': 1.0,
    'CAD': 0.738,
    'MXN': 0.051
}

def get_db_connection():
    db_urls = [
        os.getenv("DATABASE_URL"),
        "postgresql://listing_desk:listing_desk@167.233.26.87:2412/listing_desk",
        "postgresql://listing_desk:listing_desk@localhost:2412/listing_desk",
    ]
    for url in db_urls:
        if not url:
            continue
        try:
            conn = psycopg2.connect(url, connect_timeout=4)
            return conn
        except Exception:
            continue
    raise ConnectionError("Không thể kết nối tới cơ sở dữ liệu PostgreSQL (đã thử DATABASE_URL, 167.233.26.87:2412, localhost:2412)")

def resolve_store(conn, store_arg):
    cur = conn.cursor()
    cur.execute("""
        SELECT id, name FROM stores 
        WHERE id::text = %s OR UPPER(name) = UPPER(%s)
        LIMIT 1;
    """, (store_arg, store_arg))
    row = cur.fetchone()
    if not row:
        raise ValueError(f"Store '{store_arg}' not found in database stores table.")
    return row[0], row[1]

def load_sku_catalog(conn, store_id):
    cur = conn.cursor()
    cur.execute("""
        SELECT sku, asin, fnsku, product_type, amazon_fee, referral_fee_pct, pic_mkt, status, mockup_url
        FROM accounting_sku_master
        WHERE store_id = %s
    """, (store_id,))
    rows = cur.fetchall()
    sku_master = {}
    asin_to_sku = {}
    fnsku_to_sku = {}
    for r in rows:
        sku = r[0].strip() if r[0] else ''
        asin = r[1].strip() if r[1] else ''
        fnsku = r[2].strip() if r[2] else ''
        if not sku:
            continue
        sku_master[sku] = {
            'sku': sku,
            'asin': asin,
            'fnsku': fnsku,
            'product_type': r[3] or '',
            'amazon_fee': float(r[4]) if r[4] is not None else 0.0,
            'referral_fee_pct': float(r[5]) if r[5] is not None else 0.15,
            'pic_mkt': r[6] or '',
            'status': r[7] or '',
            'mockup_url': r[8] or None
        }
        if asin:
            asin_to_sku[asin] = sku
        if fnsku:
            fnsku_to_sku[fnsku] = sku
    return sku_master, asin_to_sku, fnsku_to_sku

def resolve_sku(val, sku_master, fnsku_to_sku, asin_to_sku):
    """
    Truy ngược bất kỳ mã nào (SKU, FNSKU, ASIN) về SKU chuẩn trong accounting_sku_master.
    Hỗ trợ cả so khớp chính xác và không phân biệt hoa/thường.
    """
    if not val:
        return ''
    s = str(val).strip()
    if s in sku_master:
        return s
    if s in fnsku_to_sku:
        return fnsku_to_sku[s]
    if s in asin_to_sku:
        return asin_to_sku[s]
    
    # So khớp không phân biệt hoa thường
    s_upper = s.upper()
    for k in sku_master:
        if k.upper() == s_upper:
            return k
    for f, k in fnsku_to_sku.items():
        if f.upper() == s_upper:
            return k
    for a, k in asin_to_sku.items():
        if a.upper() == s_upper:
            return k
    return ''

def load_monthly_basecosts_from_db(conn, store_id, period):
    cur = conn.cursor()
    cur.execute("""
        SELECT sku, basecost_thang 
        FROM accounting_monthly_base_cost
        WHERE store_id = %s AND period = %s
    """, (store_id, period))
    rows = cur.fetchall()
    basecosts = {}
    for r in rows:
        sku = r[0].strip() if r[0] else ''
        bc = float(r[1]) if r[1] is not None else 0.0
        if sku:
            basecosts[sku] = bc
    return basecosts

def find_file(download_dir, prefix):
    if not download_dir or not os.path.exists(download_dir):
        return None
    for f in os.listdir(download_dir):
        if f.startswith(prefix) and (f.endswith('.csv') or f.endswith('.tsv')):
            return os.path.join(download_dir, f)
    return None

def parse_all_orders(orders_file, sku_master, asin_to_sku, fnsku_to_sku, basecosts, settled_order_ids):
    sku_orders = defaultdict(lambda: {
        'revenue': 0.0,
        'quantity': 0,
        'basecost': 0.0,
        'amazon_fee_unrec': 0.0,
        'tax_order': 0.0,
        'settled_count': 0,
        'unrec_count': 0
    })
    
    if not orders_file or not os.path.exists(orders_file):
        print(f"  ⚠️ Warning: AllOrders file not found: {orders_file}")
        return sku_orders

    unmapped_orders = defaultdict(lambda: {'qty': 0, 'sales': 0.0, 'orders': set()})

    with open(orders_file, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            order_id = row.get('amazon-order-id', '').strip()
            sales_channel = row.get('sales-channel', '').strip()
            
            # Exclude removal orders
            if order_id.startswith('S01-') or sales_channel == 'Non-Amazon':
                continue
            
            status = row.get('order-status', '').strip()
            if status == 'Cancelled':
                continue
                
            raw_sku = row.get('sku', '').strip()
            asin = row.get('asin', '').strip()
            
            # Resolve SKU from SKU, FNSKU, or ASIN
            sku = resolve_sku(raw_sku, sku_master, fnsku_to_sku, asin_to_sku)
            if not sku and asin in asin_to_sku:
                sku = asin_to_sku[asin]

            currency = row.get('currency', '').strip() or 'USD'
            fulfillment = row.get('fulfillment-channel', '').strip()
            
            try: qty = int(row.get('quantity', 0) or 0)
            except: qty = 0
            try: price = float(row.get('item-price', 0) or 0)
            except: price = 0.0
            try: shipping = float(row.get('shipping-price', 0) or 0)
            except: shipping = 0.0
            
            total = (price + shipping) if fulfillment == 'Merchant' else price
            rate = CURRENCY_RATES.get(currency, 1.0)
            sales = total * rate

            if not sku or sku not in sku_master:
                unmapped_orders[(raw_sku, asin)]['qty'] += qty
                unmapped_orders[(raw_sku, asin)]['sales'] += sales
                unmapped_orders[(raw_sku, asin)]['orders'].add(order_id)
                continue
            
            sku_info = sku_master.get(sku, {})
            std_fba_fee = sku_info.get('amazon_fee', 0.0)
            referral_pct = sku_info.get('referral_fee_pct', 0.15)
            
            bc_unit = basecosts.get(sku) or 0.0
            item_basecost = bc_unit * qty
            
            is_settled = (order_id in settled_order_ids)
            
            if is_settled:
                tax = -sales * 0.01
                unrec_fee = 0.0
                sku_orders[sku]['settled_count'] += 1
            else:
                unrec_fee = -(std_fba_fee * qty + referral_pct * sales)
                tax = -(sales * referral_pct * 0.10 + sales * 0.01)
                sku_orders[sku]['unrec_count'] += 1
            
            sku_orders[sku]['revenue'] += sales
            sku_orders[sku]['quantity'] += qty
            sku_orders[sku]['basecost'] += -item_basecost
            sku_orders[sku]['amazon_fee_unrec'] += unrec_fee
            sku_orders[sku]['tax_order'] += tax

    if unmapped_orders:
        print("\n🚨 [CẢNH BÁO ĐƠN HÀNG CHỨA SKU CHƯA CÓ TRONG BẢNG MÃ]:")
        for (r_sku, r_asin), info in unmapped_orders.items():
            print(f"  ⚠️ SKU '{r_sku}' (ASIN: {r_asin}) - {info['qty']} sản phẩm | Doanh thu: ${info['sales']:.2f} ({len(info['orders'])} đơn: {list(info['orders'])[:3]}...)")
        print("  -> Vui lòng bổ sung SKU trên vào bảng accounting_sku_master để ghi nhận doanh thu đầy đủ!\n")

    return sku_orders

def get_month_order_ids(orders_file):
    if not orders_file or not os.path.exists(orders_file):
        return set()
    m_ids = set()
    with open(orders_file, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            oid = row.get('amazon-order-id', '').strip()
            sales_channel = row.get('sales-channel', '').strip()
            status = row.get('order-status', '').strip()
            if oid.startswith('S01-') or sales_channel == 'Non-Amazon':
                continue
            if status == 'Cancelled':
                continue
            m_ids.add(oid)
    return m_ids

def parse_transactions(trans_file, sku_master, asin_to_sku, fnsku_to_sku, basecosts, month_order_ids):
    sku_trans = defaultdict(lambda: {
        'amazon_fee_trans': 0.0,
        'return_amount': 0.0,
        'adjustment': 0.0,
        'fba_customer_return_fee': 0.0,
        'liquidations': 0.0,
        'basecost_return_adjustment': 0.0,
        'basecost_adjustment': 0.0,
        'removal_trans': 0.0
    })
    
    settled_order_ids = set()
    awd_sub_fees = 0.0
    fba_storage_fee_trans = 0.0
    unmapped_transactions = defaultdict(float)
    
    if not trans_file or not os.path.exists(trans_file):
        print(f"  ⚠️ Warning: DateRangeTransactions file not found: {trans_file}")
        return sku_trans, settled_order_ids, awd_sub_fees, fba_storage_fee_trans

    with open(trans_file, 'r', encoding='utf-8-sig', errors='replace') as f:
        lines = f.readlines()
        header_idx = -1
        for i, line in enumerate(lines):
            if line.startswith('"date/time","settlement id"') or line.startswith('date/time,settlement id'):
                header_idx = i
                break
        
        if header_idx == -1:
            print(f"  ⚠️ Warning: Could not find DateRangeTransactions header in {trans_file}")
            return sku_trans, settled_order_ids, awd_sub_fees, fba_storage_fee_trans
            
        reader = csv.DictReader(lines[header_idx:])
        for row in reader:
            ttype = row.get('type', '').strip()
            order_id = row.get('order id', '').strip()
            raw_sku = row.get('sku', '').strip()
            desc = row.get('description', '').strip()
            
            # Resolve SKU from SKU, FNSKU, or ASIN in description
            target_sku = resolve_sku(raw_sku, sku_master, fnsku_to_sku, asin_to_sku)
            if not target_sku and desc:
                m = re.search(r'for ASIN: ([A-Z0-9]+)', desc) or re.search(r'ASIN:?\s*([A-Z0-9]{10})', desc)
                if m:
                    target_sku = asin_to_sku.get(m.group(1), '')
            
            def get_f(col):
                val = row.get(col, '')
                if not val: return 0.0
                val = str(val).replace(',', '').strip()
                try: return float(val)
                except: return 0.0
            
            total = get_f('total')
            product_sales = get_f('product sales')
            shipping_credits = get_f('shipping credits')
            fulfillment = row.get('fulfillment', '').strip()
            
            if ttype == 'Order':
                if target_sku and target_sku in sku_master:
                    if order_id in month_order_ids:
                        settled_order_ids.add(order_id)
                        fee = (total - product_sales - shipping_credits) if fulfillment == 'Seller' else (total - product_sales)
                        sku_trans[target_sku]['amazon_fee_trans'] += fee
                elif raw_sku and order_id in month_order_ids:
                    unmapped_transactions[(ttype, raw_sku)] += total
                
            elif ttype == 'Refund':
                if target_sku and target_sku in sku_master:
                    sku_trans[target_sku]['return_amount'] += total
                    bc_unit = basecosts.get(target_sku) or 0.0
                    qty = abs(get_f('quantity')) or 1.0
                    if total < 0:
                        sku_trans[target_sku]['basecost_return_adjustment'] += bc_unit * qty
                    elif total > 0:
                        sku_trans[target_sku]['basecost_return_adjustment'] -= bc_unit * qty
                elif raw_sku:
                    unmapped_transactions[(ttype, raw_sku)] += total
                    
            elif ttype in ['Adjustment', 'Fee Adjustment']:
                if target_sku and target_sku in sku_master:
                    sku_trans[target_sku]['adjustment'] += total
                    bc_unit = basecosts.get(target_sku) or 0.0
                    qty = abs(get_f('quantity')) or 1.0
                    if total < 0:
                        sku_trans[target_sku]['basecost_return_adjustment'] += bc_unit * qty
                        sku_trans[target_sku]['basecost_adjustment'] += bc_unit * qty
                    elif total > 0:
                        sku_trans[target_sku]['basecost_return_adjustment'] -= bc_unit * qty
                        sku_trans[target_sku]['basecost_adjustment'] -= bc_unit * qty
                elif raw_sku:
                    unmapped_transactions[(ttype, raw_sku)] += total
                        
            elif 'FBA Customer Return' in ttype or 'FBA Customer Return' in desc:
                if target_sku and target_sku in sku_master:
                    sku_trans[target_sku]['fba_customer_return_fee'] += total
                else:
                    awd_sub_fees += total
                    
            elif ttype == 'Liquidations' or 'Liquidations' in desc:
                if target_sku and target_sku in sku_master:
                    sku_trans[target_sku]['liquidations'] += total
                else:
                    unmapped_transactions[('Liquidations', raw_sku or desc[:30])] += total
                
            elif 'Removal' in desc or 'removal' in desc.lower():
                if target_sku and target_sku in sku_master:
                    sku_trans[target_sku]['removal_trans'] += total
                else:
                    unmapped_transactions[('Removal', raw_sku or desc[:30])] += total
                
            elif ttype == 'FBA Transaction fees':
                if 'AWD' in desc:
                    awd_sub_fees += total
                elif 'FBA Inventory Storage Fee' in desc:
                    fba_storage_fee_trans += total
                    
            elif ttype == 'Service Fee':
                if 'Subscription' in desc:
                    awd_sub_fees += total
                    
    if unmapped_transactions:
        print("\n⚠️ [GIAO DỊCH CHỨA MÃ CHƯA MAP ĐƯỢC VỚI BẢNG MÃ]:")
        for (tp, code), amt in unmapped_transactions.items():
            print(f"  • Loại: {tp} | Mã: '{code}' | Số tiền: ${amt:.2f}")

    return sku_trans, settled_order_ids, awd_sub_fees, fba_storage_fee_trans

def parse_ads(ads_file, valid_skus):
    sku_ads = defaultdict(lambda: {'spend': 0.0, 'sales': 0.0, 'tax': 0.0})
    if not ads_file or not os.path.exists(ads_file):
        return sku_ads
        
    sorted_skus = sorted(list(valid_skus), key=lambda x: len(x), reverse=True)
    
    with open(ads_file, 'r', encoding='utf-8-sig', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('Portfolio') or row.get('Portfolio name') or ''
            name = name.strip()
            if not name:
                continue
                
            # Match against genuine SKUs only
            matched_sku = None
            tokens = re.findall(r'[A-Za-z0-9_-]+', name)
            for t in reversed(tokens):
                t_clean = t.strip()
                if t_clean in valid_skus:
                    matched_sku = t_clean
                    break
                t_upper = t_clean.upper()
                if t_upper in valid_skus:
                    matched_sku = t_upper
                    break
                    
            if not matched_sku:
                # Fallback: check substrings if token has prefixes/suffixes
                upper_name = name.upper()
                for s in sorted_skus[:100]: # Check top longest SKUs only if needed
                    if s.upper() in upper_name:
                        matched_sku = s
                        break
                        
            # If no genuine SKU found, skip to avoid garbage SKUs
            if not matched_sku:
                continue
            
            def get_f(col):
                val = row.get(col, '')
                if not val: return 0.0
                try: return float(str(val).replace(',', ''))
                except: return 0.0
            
            spend = get_f('Spend(USD)') or get_f('Spend')
            sales = get_f('Sales(USD)') or get_f('Sales')
            tax = spend * 0.10
            
            sku_ads[matched_sku]['spend'] += spend
            sku_ads[matched_sku]['sales'] += sales
            sku_ads[matched_sku]['tax'] += tax
            
    return sku_ads

def parse_auxiliary_fees(download_dir, sku_master, asin_to_sku, fnsku_to_sku, basecosts, storage_file=None, storage_month=None):
    # Placement
    placement_file = find_file(download_dir, "12_InboundPlacementFees")
    sku_placement = defaultdict(float)
    if placement_file and os.path.exists(placement_file):
        with open(placement_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                asin = (row.get('asin') or row.get('ASIN') or '').strip()
                raw_sku = (row.get('sku') or row.get('SKU') or '').strip()
                sku = resolve_sku(raw_sku, sku_master, fnsku_to_sku, asin_to_sku) or asin_to_sku.get(asin, '')
                amt = row.get('amount') or row.get('Total charges') or 0
                try: chg = float(str(amt).replace(',', '') or 0)
                except: chg = 0.0
                if sku and sku in sku_master:
                    sku_placement[sku] += chg

    # Long-term storage
    lt_file = find_file(download_dir, "13_LongTermStorageFees")
    sku_longterm = defaultdict(float)
    if lt_file and os.path.exists(lt_file):
        with open(lt_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                asin = (row.get('asin') or row.get('ASIN') or '').strip()
                raw_sku = (row.get('sku') or '').strip()
                fnsku = (row.get('fnsku') or '').strip()
                sku = resolve_sku(raw_sku or fnsku, sku_master, fnsku_to_sku, asin_to_sku) or asin_to_sku.get(asin, '')
                amt = row.get('amount-charged') or 0
                try: chg = float(str(amt).replace(',', '') or 0)
                except: chg = 0.0
                if sku and sku in sku_master:
                    sku_longterm[sku] += chg

    # Removal orders
    removal_file = find_file(download_dir, "11_RemovalOrderDetail")
    sku_removal = defaultdict(float)
    if removal_file and os.path.exists(removal_file):
        with open(removal_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                raw_sku = row.get('sku', '').strip()
                fnsku = row.get('fnsku', '').strip()
                sku = resolve_sku(raw_sku or fnsku, sku_master, fnsku_to_sku, asin_to_sku)
                try: qty = int(row.get('shipped-quantity', 0) or 0)
                except: qty = 0
                bc_unit = basecosts.get(sku, 0.0)
                if sku and sku in sku_master:
                    sku_removal[sku] += bc_unit * qty

    # Storage fees: period M uses report with month_of_charge = M-1
    sku_storage = defaultdict(float)
    if storage_file and os.path.exists(storage_file):
        with open(storage_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if storage_month and (row.get('month_of_charge') or '').strip()[:7] != storage_month:
                    continue
                asin = (row.get('asin') or '').strip()
                fnsku = (row.get('fnsku') or '').strip()
                sku = resolve_sku(fnsku, sku_master, fnsku_to_sku, asin_to_sku) or asin_to_sku.get(asin, '')
                amt = row.get('estimated_monthly_storage_fee') or 0
                try: chg = float(str(amt).replace(',', '') or 0)
                except: chg = 0.0
                if sku and sku in sku_master:
                    sku_storage[sku] += chg

    return sku_placement, sku_longterm, sku_removal, sku_storage

def ingest_monthly(store_name_or_id, period, raw_dir=None, dry_run=False, force=False):
    year, month = [int(p) for p in period.split('-')]
    
    conn = get_db_connection()
    store_id, store_name = resolve_store(conn, store_name_or_id)
    print(f"\n🚀 Running Monthly Ingestion Pipeline for: {store_name} ({store_id}) | Month: {period}")
    
    # Check if month is already locked / finalized in DB
    cur = conn.cursor()
    cur.execute("""
        SELECT count(*) FROM accounting_monthly_store_summary 
        WHERE store_id = %s AND year = %s AND month = %s
    """, (store_id, year, month))
    exists = cur.fetchone()[0] > 0
    if exists and not force and not dry_run:
        print(f"⚠️ Kỳ {period} đã tồn tại trong cơ sở dữ liệu. Bỏ qua để bảo vệ số liệu lịch sử (Dùng --force để ghi đè).")
        conn.close()
        return
        
    download_dir = raw_dir or os.path.join(DEFAULT_DOWNLOAD_ROOT, period, store_name)
    if not os.path.exists(download_dir):
        raise FileNotFoundError(f"Download directory not found: {download_dir}")
        
    print(f"📁 Reading raw crawler reports from: {download_dir}")
    
    # 1. Load catalog & basecosts from DB
    sku_master, asin_to_sku, fnsku_to_sku = load_sku_catalog(conn, store_id)
    basecosts = load_monthly_basecosts_from_db(conn, store_id, period)
    print(f"📦 Loaded {len(sku_master)} valid SKUs from master, {len(basecosts)} basecosts for period {period}.")
    
    # 2. Parse All Orders
    orders_file = find_file(download_dir, "02_AllOrders")
    month_order_ids = get_month_order_ids(orders_file)
    print(f"🛒 Identified {len(month_order_ids)} orders placed in {period}.")
    
    # 3. Parse Transactions
    trans_file = find_file(download_dir, "15_DateRangeTransactions")
    sku_trans, settled_order_ids, awd_sub_fees, fba_storage_trans = parse_transactions(
        trans_file, sku_master, asin_to_sku, fnsku_to_sku, basecosts, month_order_ids
    )
    print(f"💳 Settled {len(settled_order_ids)} orders in transactions. AWD/Sub fees = {awd_sub_fees:.2f}")
    
    # 4. Parse Orders with settlement status
    sku_orders = parse_all_orders(orders_file, sku_master, asin_to_sku, fnsku_to_sku, basecosts, settled_order_ids)
    
    # 5. Parse Ads (Strict SKU filter against sku_master)
    ads_file = find_file(download_dir, "01_Portfolios") or find_file(download_dir, "05_Campaigns")
    sku_ads = parse_ads(ads_file, set(sku_master.keys()))
    print(f"📢 Parsed ads for {len(sku_ads)} valid SKUs.")
    
    # 6. Parse Placement, Long-term, Removal, Storage
    # Storage fee rule: period M reads report with month_of_charge = M-1
    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    storage_month = f"{prev_year}-{prev_month:02d}"
    download_root = os.path.dirname(os.path.dirname(os.path.normpath(download_dir)))
    storage_dir = os.path.join(download_root, storage_month, os.path.basename(os.path.normpath(download_dir)))
    storage_file = find_file(storage_dir, "14_MonthlyStorageFees")
    
    if storage_file:
        print(f"🏬 Lưu kho kỳ {period} lấy từ báo cáo tháng {storage_month}: {storage_file}")
    else:
        print(f"⚠️  THIẾU báo cáo lưu kho tháng {storage_month} ({storage_dir})")
        print(f"   👉 Tải báo cáo thật từ Amazon (không đè DB):")
        print(f"      npx tsx mac-crawler/monthly_crawler.ts --month={storage_month} --store={store_name} --reports=14 --no-ingest")
        if fba_storage_trans != 0:
            print(f"   ℹ️ Phát hiện phí lưu kho thực tế trong DateRangeTransactions: ${fba_storage_trans:.2f}")

    sku_placement, sku_longterm, sku_removal, sku_storage = parse_auxiliary_fees(
        download_dir, sku_master, asin_to_sku, fnsku_to_sku, basecosts, storage_file, storage_month
    )
    
    # 7. Aggregate SKU level and Store level (strictly within sku_master)
    all_skus = sorted(list(sku_master.keys()))
    
    sku_rows = []
    tot = defaultdict(float)
    tot['awd_subscription_fees'] = awd_sub_fees
    
    for sku in all_skus:
        info = sku_master[sku]
        o_data = sku_orders[sku]
        a_data = sku_ads[sku]
        t_data = sku_trans[sku]
        
        rev = o_data['revenue']
        qty = o_data['quantity']
        ads_fee = -a_data['spend']
        bc = o_data['basecost']
        amz_unrec = o_data['amazon_fee_unrec']
        amz_trans = t_data['amazon_fee_trans']
        tax = -a_data['tax'] + o_data['tax_order']
        ret = t_data['return_amount']
        adj = t_data['adjustment']
        storage = -sku_storage[sku]
        placement = -sku_placement[sku]
        longterm = -sku_longterm[sku]
        fba_ret = t_data['fba_customer_return_fee']
        liq = t_data['liquidations']
        bc_ret_adj = t_data['basecost_return_adjustment']
        bc_adj = t_data['basecost_adjustment']
        rem = -sku_removal[sku] + t_data['removal_trans']
        
        sku_profit = rev + ads_fee + bc + amz_unrec + amz_trans + tax + ret + adj + storage + placement + longterm + fba_ret + liq + bc_ret_adj + rem
        
        tacos = (ads_fee / rev) if rev > 0 else 0.0
        acos = (ads_fee / a_data['sales']) if a_data['sales'] > 0 else 0.0
        margin = (sku_profit / rev) if rev > 0 else 0.0
        roi = (-sku_profit / bc) if bc != 0 else 0.0
        profit_per_item = (sku_profit / qty) if qty > 0 else 0.0
        bc_per_item = (bc / qty) if qty > 0 else 0.0
        
        sku_rows.append({
            'sku': sku,
            'asin': info.get('asin', ''),
            'product_type': info.get('product_type', ''),
            'mockup_url': info.get('mockup_url'),
            'fnsku': info.get('fnsku', ''),
            'status': info.get('status', ''),
            'revenue': rev,
            'quantity': qty,
            'ads_fee': ads_fee,
            'basecost': bc,
            'amazon_fee_unrecognized': amz_unrec,
            'amazon_fee_trans': amz_trans,
            'thue': tax,
            'return_amount': ret,
            'adjustment': adj,
            'storage_fee': storage,
            'placement_fee': placement,
            'long_term_fee': longterm,
            'fba_customer_return_fee': fba_ret,
            'liquidations': liq,
            'basecost_return_adjustment': bc_ret_adj,
            'basecost_adjustment': bc_adj,
            'removal': rem,
            'profit': sku_profit,
            'tacos': tacos,
            'acos': acos,
            'margin': margin,
            'roi': roi,
            'profit_per_item': profit_per_item,
            'basecost_per_item': bc_per_item,
            'revenue_ads': a_data['sales']
        })
        
        tot['revenue'] += rev
        tot['quantity'] += qty
        tot['ads_fee'] += ads_fee
        tot['basecost'] += bc
        tot['amazon_fee_unrec'] += amz_unrec
        tot['amazon_fee_trans'] += amz_trans
        tot['thue'] += tax
        tot['return'] += ret
        tot['adjustment'] += adj
        tot['storage'] += storage
        tot['placement'] += placement
        tot['longterm'] += longterm
        tot['fba_ret'] += fba_ret
        tot['liquidations'] += liq
        tot['basecost_return_adj'] += bc_ret_adj
        tot['basecost_adjustment'] += bc_adj
        tot['removal'] += rem
        tot['sku_profit'] += sku_profit
        tot['revenue_ads'] += a_data['sales']

    net_profit = tot['sku_profit'] + awd_sub_fees
    
    store_tacos = (tot['ads_fee'] / tot['revenue']) if tot['revenue'] > 0 else 0.0
    store_acos = (tot['ads_fee'] / tot['revenue_ads']) if tot['revenue_ads'] > 0 else 0.0
    store_margin = (net_profit / tot['revenue']) if tot['revenue'] > 0 else 0.0
    store_roi = (net_profit / tot['basecost']) if tot['basecost'] != 0 else 0.0
    
    active_skus = sum(1 for r in sku_rows if r['revenue'] > 0 or r['quantity'] > 0 or r['ads_fee'] != 0 or r['profit'] != 0 or r['storage_fee'] != 0)
    
    print("\n" + "="*80)
    print(f"📊 SUMMARY RESULTS FOR {store_name} | {period}")
    print("="*80)
    print(f"Total Revenue                  : ${tot['revenue']:>14.2f}")
    print(f"Total Quantity                 : {tot['quantity']:>14.0f}")
    print(f"Total Ads Fee                  : ${tot['ads_fee']:>14.2f}")
    print(f"Total Basecost                 : ${tot['basecost']:>14.2f}")
    print(f"Total Amazon Fee (Unrecognized): ${tot['amazon_fee_unrec']:>14.2f}")
    print(f"Total Amazon Fee (Transactions): ${tot['amazon_fee_trans']:>14.2f}")
    print(f"Total Taxes                    : ${tot['thue']:>14.2f}")
    print(f"Total Returns                  : ${tot['return']:>14.2f}")
    print(f"Total Adjustments              : ${tot['adjustment']:>14.2f}")
    print(f"Total Storage Fee              : ${tot['storage']:>14.2f}")
    print(f"Total Placement Fee            : ${tot['placement']:>14.2f}")
    print(f"Total Long-Term Fee            : ${tot['longterm']:>14.2f}")
    print(f"Total FBA Customer Return Fee  : ${tot['fba_ret']:>14.2f}")
    print(f"Total Liquidations             : ${tot['liquidations']:>14.2f}")
    print(f"Total Basecost Return Adj      : ${tot['basecost_return_adj']:>14.2f}")
    print(f"Total Basecost Adjustment      : ${tot['basecost_adjustment']:>14.2f}")
    print(f"Total Removal                  : ${tot['removal']:>14.2f}")
    print(f"Total SKU Profit               : ${tot['sku_profit']:>14.2f}")
    print(f"AWD / Subscription Fees        : ${awd_sub_fees:>14.2f}")
    print(f"Net Profit (Store Total)       : ${net_profit:>14.2f}")
    print(f"Revenue Ads                    : ${tot['revenue_ads']:>14.2f}")
    print(f"Store TACoS                    : {store_tacos:>14.2%}")
    print(f"Store ACoS                     : {store_acos:>14.2%}")
    print(f"Store Margin                   : {store_margin:>14.2%}")
    print(f"Store ROI (Excel definition)   : {store_roi:>14.4f}")
    print(f"Active SKUs                    : {active_skus:>14d} / {len(sku_rows)}")
    print("="*80)
    
    if dry_run:
        print("\n⚡ DRY RUN: Skipped database write.")
        conn.close()
        return

    # 8. Upsert into database
    print(f"\n💾 Upserting {len(sku_rows)} genuine SKUs into accounting_sku_monthly...")
    # Delete any invalid SKUs outside of sku_master for this month
    cur.execute(
        "DELETE FROM accounting_sku_monthly WHERE store_id = %s AND year = %s AND month = %s AND sku NOT IN %s",
        (store_id, year, month, tuple(sku_master.keys()))
    )
    
    for r in sku_rows:
        cur.execute("""
            INSERT INTO accounting_sku_monthly (
                store_id, year, month, sku, asin, product_type, mockup_url, fnsku, status,
                revenue, quantity, ads_fee, basecost, amazon_fee_unrecognized, amazon_fee_trans,
                thue, return_amount, adjustment, storage_fee, placement_fee, long_term_fee,
                fba_customer_return_fee, liquidations, basecost_return_adjustment, basecost_adjustment, removal,
                profit, tacos, acos, margin, roi, profit_per_item, basecost_per_item,
                revenue_ads, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, NOW(), NOW()
            )
            ON CONFLICT (store_id, year, month, sku) DO UPDATE
            SET asin = EXCLUDED.asin,
                product_type = EXCLUDED.product_type,
                mockup_url = COALESCE(EXCLUDED.mockup_url, accounting_sku_monthly.mockup_url),
                fnsku = EXCLUDED.fnsku,
                status = EXCLUDED.status,
                revenue = EXCLUDED.revenue,
                quantity = EXCLUDED.quantity,
                ads_fee = EXCLUDED.ads_fee,
                basecost = EXCLUDED.basecost,
                amazon_fee_unrecognized = EXCLUDED.amazon_fee_unrecognized,
                amazon_fee_trans = EXCLUDED.amazon_fee_trans,
                thue = EXCLUDED.thue,
                return_amount = EXCLUDED.return_amount,
                adjustment = EXCLUDED.adjustment,
                storage_fee = EXCLUDED.storage_fee,
                placement_fee = EXCLUDED.placement_fee,
                long_term_fee = EXCLUDED.long_term_fee,
                fba_customer_return_fee = EXCLUDED.fba_customer_return_fee,
                liquidations = EXCLUDED.liquidations,
                basecost_return_adjustment = EXCLUDED.basecost_return_adjustment,
                basecost_adjustment = EXCLUDED.basecost_adjustment,
                removal = EXCLUDED.removal,
                profit = EXCLUDED.profit,
                tacos = EXCLUDED.tacos,
                acos = EXCLUDED.acos,
                margin = EXCLUDED.margin,
                roi = EXCLUDED.roi,
                profit_per_item = EXCLUDED.profit_per_item,
                basecost_per_item = EXCLUDED.basecost_per_item,
                revenue_ads = EXCLUDED.revenue_ads,
                updated_at = NOW();
        """, (
            store_id, year, month, r['sku'], r['asin'], r['product_type'], r['mockup_url'], r['fnsku'], r['status'],
            r['revenue'], r['quantity'], r['ads_fee'], r['basecost'], r['amazon_fee_unrecognized'], r['amazon_fee_trans'],
            r['thue'], r['return_amount'], r['adjustment'], r['storage_fee'], r['placement_fee'], r['long_term_fee'],
            r['fba_customer_return_fee'], r['liquidations'], r['basecost_return_adjustment'], r['basecost_adjustment'], r['removal'],
            r['profit'], r['tacos'], r['acos'], r['margin'], r['roi'], r['profit_per_item'], r['basecost_per_item'],
            r['revenue_ads']
        ))

    print(f"💾 Upserting store summary into accounting_monthly_store_summary...")
    cur.execute("""
        INSERT INTO accounting_monthly_store_summary (
            store_id, year, month, total_revenue, total_quantity, total_ads_fee, total_basecost,
            total_amazon_fee_unrecognized, total_amazon_fee_trans, total_thue, total_return_amount,
            total_adjustment, total_storage_fee, total_placement_fee, total_long_term_fee,
            total_fba_customer_return_fee, total_liquidations, total_basecost_return_adj,
            basecost_adjustment, total_removal, awd_subscription_fees, total_sku_profit, net_profit,
            total_revenue_ads, tacos, acos, margin, roi, active_sku_count, total_sku_count,
            created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s,
            NOW(), NOW()
        )
        ON CONFLICT (store_id, year, month) DO UPDATE
        SET total_revenue = EXCLUDED.total_revenue,
            total_quantity = EXCLUDED.total_quantity,
            total_ads_fee = EXCLUDED.total_ads_fee,
            total_basecost = EXCLUDED.total_basecost,
            total_amazon_fee_unrecognized = EXCLUDED.total_amazon_fee_unrecognized,
            total_amazon_fee_trans = EXCLUDED.total_amazon_fee_trans,
            total_thue = EXCLUDED.total_thue,
            total_return_amount = EXCLUDED.total_return_amount,
            total_adjustment = EXCLUDED.total_adjustment,
            total_storage_fee = EXCLUDED.total_storage_fee,
            total_placement_fee = EXCLUDED.total_placement_fee,
            total_long_term_fee = EXCLUDED.total_long_term_fee,
            total_fba_customer_return_fee = EXCLUDED.total_fba_customer_return_fee,
            total_liquidations = EXCLUDED.total_liquidations,
            total_basecost_return_adj = EXCLUDED.total_basecost_return_adj,
            basecost_adjustment = EXCLUDED.basecost_adjustment,
            total_removal = EXCLUDED.total_removal,
            awd_subscription_fees = EXCLUDED.awd_subscription_fees,
            total_sku_profit = EXCLUDED.total_sku_profit,
            net_profit = EXCLUDED.net_profit,
            total_revenue_ads = EXCLUDED.total_revenue_ads,
            tacos = EXCLUDED.tacos,
            acos = EXCLUDED.acos,
            margin = EXCLUDED.margin,
            roi = EXCLUDED.roi,
            active_sku_count = EXCLUDED.active_sku_count,
            total_sku_count = EXCLUDED.total_sku_count,
            updated_at = NOW();
    """, (
        store_id, year, month, tot['revenue'], tot['quantity'], tot['ads_fee'], tot['basecost'],
        tot['amazon_fee_unrec'], tot['amazon_fee_trans'], tot['thue'], tot['return'],
        tot['adjustment'], tot['storage'], tot['placement'], tot['longterm'],
        tot['fba_ret'], tot['liquidations'], tot['basecost_return_adj'], tot['basecost_adjustment'],
        tot['removal'], awd_sub_fees, tot['sku_profit'], net_profit,
        tot['revenue_ads'], store_tacos, store_acos, store_margin, store_roi, active_skus, len(sku_rows)
    ))
    
    conn.commit()
    conn.close()
    print("✅ Monthly ingestion completed successfully!\n")

def main():
    parser = argparse.ArgumentParser(description="Ingest monthly accounting data from raw crawler reports.")
    parser.add_argument("--store", required=True, help="Store name or ID (e.g. WARMSTOREY)")
    parser.add_argument("--month", required=True, help="Target month in YYYY-MM format (e.g. 2026-09)")
    parser.add_argument("--dir", required=False, help="Custom download directory path")
    parser.add_argument("--dry-run", action="store_true", help="Calculate without writing to database")
    parser.add_argument("--force", action="store_true", help="Force overwrite even if month already exists in DB")
    
    args = parser.parse_args()
    ingest_monthly(args.store, args.month, raw_dir=args.dir, dry_run=args.dry_run, force=args.force)

if __name__ == '__main__':
    main()
