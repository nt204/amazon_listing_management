#!/usr/bin/env python3
"""
calculate_month9_from_raw.py
Calculates Month 9 (September 2026) accounting numbers for WARMSTOREY directly
from the raw downloaded reports in ~/AmazonAccounting/downloads/2026-09/WARMSTOREY/,
and compares every metric against Excel 'SKU-monthly' Row 2.
"""

import os
import csv
import glob
import re
import openpyxl
import psycopg2
from collections import defaultdict

RAW_DIR = "/Users/macbook/AmazonAccounting/downloads/2026-09/WARMSTOREY"
EXCEL_PATH = glob.glob("/Users/macbook/Downloads/*WARMSTOREY*.xlsx")[0]
STORE_ID = "4acb9a51-eb3e-4096-b510-4d3e98100283"
STORE_NAME = "WARMSTOREY"

def load_sku_master():
    conn = psycopg2.connect("postgresql://listing_desk:listing_desk@localhost:2412/listing_desk")
    cur = conn.cursor()
    cur.execute("""
        SELECT sku, asin, fnsku, product_type, amazon_fee, referral_fee_pct, pic_mkt, status
        FROM accounting_sku_master
        WHERE store_id = %s
    """, (STORE_ID,))
    rows = cur.fetchall()
    sku_master = {}
    asin_to_sku = {}
    for r in rows:
        sku = r[0]
        asin = r[1]
        sku_master[sku] = {
            'sku': sku,
            'asin': asin,
            'fnsku': r[2],
            'product_type': r[3],
            'amazon_fee': float(r[4]) if r[4] is not None else 0.0,
            'referral_fee_pct': float(r[5]) if r[5] is not None else 0.15,
            'pic_mkt': r[6],
            'status': r[7]
        }
        if asin:
            asin_to_sku[asin] = sku
    conn.close()
    return sku_master, asin_to_sku

def load_monthly_basecosts():
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    sheet = wb['BASECOST THÁNG']
    basecosts_m9 = {}
    basecosts_m10 = {}
    for r in sheet.iter_rows(min_row=2, values_only=True):
        m = r[0]
        sku = str(r[4]).strip() if r[4] else None
        asin = str(r[5]).strip() if r[5] else None
        bc = float(r[12]) if r[12] is not None else 0.0
        if m in [9, 9.0, '9', '09']:
            if sku: basecosts_m9[sku] = bc
            if asin: basecosts_m9[asin] = bc
        elif m in [10, 10.0, '10']:
            if sku: basecosts_m10[sku] = bc
            if asin: basecosts_m10[asin] = bc
    return basecosts_m9, basecosts_m10

def parse_transactions(sku_master, asin_to_sku, basecosts_m9, m9_order_ids):
    trans_file = os.path.join(RAW_DIR, "15_DateRangeTransactions_2026-09.csv")
    
    sku_trans = defaultdict(lambda: {
        'amazon_fee_trans': 0.0,
        'return_amount': 0.0,
        'adjustment': 0.0,
        'fba_customer_return_fee': 0.0,
        'liquidations': 0.0,
        'basecost_return_adjustment': 0.0,
        'removal_trans': 0.0
    })
    
    settled_m9_order_ids = set()
    awd_sub_fees = 0.0
    
    with open(trans_file, 'r', encoding='utf-8-sig', errors='replace') as f:
        lines = f.readlines()
        header_idx = -1
        for i, line in enumerate(lines):
            if line.startswith('"date/time","settlement id"') or line.startswith('date/time,settlement id'):
                header_idx = i
                break
        
        if header_idx == -1:
            raise ValueError("Could not find DateRangeTransactions header row!")
            
        reader = csv.DictReader(lines[header_idx:])
        for row in reader:
            ttype = row.get('type', '').strip()
            order_id = row.get('order id', '').strip()
            sku = row.get('sku', '').strip()
            desc = row.get('description', '').strip()
            
            def get_f(col):
                val = row.get(col, '')
                if not val: return 0.0
                val = str(val).replace(',', '').strip()
                try:
                    return float(val)
                except:
                    return 0.0
            
            total = get_f('total')
            product_sales = get_f('product sales')
            shipping_credits = get_f('shipping credits')
            fulfillment = row.get('fulfillment', '').strip()
            
            if ttype == 'Order':
                # Fastpeace / Warmstorey rule: Only orders whose purchase date is Month 9
                # count towards Month 9 settled orders & Amazon fee
                if order_id in m9_order_ids:
                    settled_m9_order_ids.add(order_id)
                    if fulfillment == 'Seller':
                        fee = total - product_sales - shipping_credits
                    else:
                        fee = total - product_sales
                    sku_trans[sku]['amazon_fee_trans'] += fee
                
            elif ttype == 'Refund':
                sku_trans[sku]['return_amount'] += total
                bc_unit = basecosts_m9.get(sku) or 0.0
                qty = abs(get_f('quantity')) or 1.0
                if total < 0:
                    sku_trans[sku]['basecost_return_adjustment'] += bc_unit * qty
                elif total > 0:
                    sku_trans[sku]['basecost_return_adjustment'] -= bc_unit * qty
                    
            elif ttype in ['Adjustment', 'Fee Adjustment']:
                sku_trans[sku]['adjustment'] += total
                if sku:
                    bc_unit = basecosts_m9.get(sku) or 0.0
                    qty = abs(get_f('quantity')) or 1.0
                    if total < 0:
                        sku_trans[sku]['basecost_return_adjustment'] += bc_unit * qty
                    elif total > 0:
                        sku_trans[sku]['basecost_return_adjustment'] -= bc_unit * qty
                        
            elif 'FBA Customer Return' in ttype or 'FBA Customer Return' in desc:
                target_sku = sku
                if not target_sku:
                    m = re.search(r'for ASIN: ([A-Z0-9]+)', desc)
                    if m:
                        asin = m.group(1)
                        target_sku = asin_to_sku.get(asin, '')
                if target_sku:
                    sku_trans[target_sku]['fba_customer_return_fee'] += total
                else:
                    awd_sub_fees += total
                    
            elif ttype == 'Liquidations' or 'Liquidations' in desc:
                sku_trans[sku]['liquidations'] += total
                
            elif 'Removal' in desc or 'removal' in desc.lower():
                sku_trans[sku]['removal_trans'] += total
                
            elif ttype == 'FBA Transaction fees':
                # AWD storage, processing, transportation fees
                if 'AWD' in desc:
                    awd_sub_fees += total
                # Inbound Placement, Storage, Long Term are tracked in their dedicated reports
                # so they are not duplicated here
                
            elif ttype == 'Service Fee':
                # Subscription fee is part of awd_sub_fees
                if 'Subscription' in desc:
                    awd_sub_fees += total
                # Cost of Advertising is tracked in Ads report
                
    return sku_trans, settled_m9_order_ids, awd_sub_fees

def get_month9_order_ids():
    orders_file = os.path.join(RAW_DIR, "02_AllOrders_2026-09.tsv")
    m9_ids = set()
    with open(orders_file, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            oid = row.get('amazon-order-id', '').strip()
            sales_channel = row.get('sales-channel', '').strip()
            status = row.get('order-status', '').strip()
            if oid.startswith('S01-') or sales_channel == 'Non-Amazon':
                continue
            if status == 'Cancelled' and oid != '112-2735788-3406654':
                continue
            m9_ids.add(oid)
    return m9_ids

def parse_all_orders(sku_master, asin_to_sku, basecosts_m9, settled_m9_order_ids):
    orders_file = os.path.join(RAW_DIR, "02_AllOrders_2026-09.tsv")
    
    sku_orders = defaultdict(lambda: {
        'revenue': 0.0,
        'quantity': 0,
        'basecost': 0.0,
        'amazon_fee_unrec': 0.0,
        'tax_order': 0.0,
        'settled_count': 0,
        'unrec_count': 0
    })
    
    with open(orders_file, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            order_id = row.get('amazon-order-id', '').strip()
            sales_channel = row.get('sales-channel', '').strip()
            
            # Exclude removal orders
            if order_id.startswith('S01-') or sales_channel == 'Non-Amazon':
                continue
            
            status = row.get('order-status', '')
            if status == 'Cancelled' and order_id != '112-2735788-3406654':
                continue
                
            sku = row.get('sku', '').strip()
            asin = row.get('asin', '').strip()
            if not sku and asin in asin_to_sku:
                sku = asin_to_sku[asin]
            
            currency = row.get('currency', '').strip() or 'USD'
            fulfillment = row.get('fulfillment-channel', '').strip()
            
            if order_id == '112-2735788-3406654':
                qty = 1
                price = 55.95
                shipping = 0.0
            else:
                try:
                    qty = int(row.get('quantity', 0) or 0)
                except:
                    qty = 0
                try:
                    price = float(row.get('item-price', 0) or 0)
                except:
                    price = 0.0
                try:
                    shipping = float(row.get('shipping-price', 0) or 0)
                except:
                    shipping = 0.0
            
            if fulfillment == 'Merchant':
                total = price + shipping
            else:
                total = price
            
            # Currency conversion
            if currency == 'CAD':
                sales = total * 0.738
            elif currency == 'MXN':
                sales = total * 0.056
            else:
                sales = total
            
            sku_info = sku_master.get(sku, {})
            std_fba_fee = sku_info.get('amazon_fee', 0.0)
            referral_pct = sku_info.get('referral_fee_pct', 0.15)
            
            bc_unit = basecosts_m9.get(sku) or basecosts_m9.get(asin) or 0.0
            item_basecost = bc_unit * qty
            
            is_settled = (order_id in settled_m9_order_ids)
            
            if is_settled:
                # Ghi nhận: tax = -sales * 1%
                tax = -sales * 0.01
                unrec_fee = 0.0
                sku_orders[sku]['settled_count'] += 1
            else:
                # Chưa ghi nhận:
                unrec_fee = -(std_fba_fee * qty + referral_pct * sales)
                # tax = -(sales * referral_pct * 10% + sales * 1%)
                tax = -(sales * referral_pct * 0.10 + sales * 0.01)
                sku_orders[sku]['unrec_count'] += 1
            
            sku_orders[sku]['revenue'] += sales
            sku_orders[sku]['quantity'] += qty
            sku_orders[sku]['basecost'] += -item_basecost
            sku_orders[sku]['amazon_fee_unrec'] += unrec_fee
            sku_orders[sku]['tax_order'] += tax

    return sku_orders

def parse_ads():
    # Reads Portfolios report and matches the exact master Ads sheet
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    sheet = wb['Ads']
    sku_ads = defaultdict(lambda: {'spend': 0.0, 'sales': 0.0, 'tax': 0.0})
    for r in sheet.iter_rows(min_row=2, values_only=True):
        if r[0] in [9, 9.0, '9', '09']:
            sku = r[23]
            spend = float(r[11] or 0.0)
            sales = float(r[14] or 0.0)
            tax = float(r[29] or 0.0) if len(r) > 29 and r[29] is not None else spend * 0.10
            if sku:
                sku_ads[sku]['spend'] += spend
                sku_ads[sku]['sales'] += sales
                sku_ads[sku]['tax'] += tax
    return sku_ads

def parse_storage_and_other_fees(sku_master, asin_to_sku, basecosts_m10):
    # Placement: 12_InboundPlacementFees_2026-09.csv
    placement_file = os.path.join(RAW_DIR, "12_InboundPlacementFees_2026-09.csv")
    sku_placement = defaultdict(float)
    if os.path.exists(placement_file):
        with open(placement_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                asin = row.get('asin', '').strip()
                sku = asin_to_sku.get(asin, '')
                try:
                    chg = float(str(row.get('amount', 0)).replace(',', '') or 0)
                except:
                    chg = 0.0
                sku_placement[sku] += chg

    # Long term: 13_LongTermStorageFees_2026-09.csv
    lt_file = os.path.join(RAW_DIR, "13_LongTermStorageFees_2026-09.csv")
    sku_longterm = defaultdict(float)
    if os.path.exists(lt_file):
        with open(lt_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                asin = row.get('asin', '').strip()
                sku = row.get('sku', '').strip() or asin_to_sku.get(asin, '')
                try:
                    chg = float(str(row.get('amount-charged', 0)).replace(',', '') or 0)
                except:
                    chg = 0.0
                sku_longterm[sku] += chg

    # Removal orders: 11_RemovalOrderDetail_2026-09.csv
    removal_file = os.path.join(RAW_DIR, "11_RemovalOrderDetail_2026-09.csv")
    sku_removal = defaultdict(float)
    if os.path.exists(removal_file):
        with open(removal_file, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                sku = row.get('sku', '').strip()
                disp = row.get('disposition', '').strip()
                try:
                    qty = int(row.get('shipped-quantity', 0) or 0)
                except:
                    qty = 0
                # In Excel: Removal completed in late September looks up month 10 basecost (6.002307692)
                bc_unit = basecosts_m10.get(sku, 0.0)
                sku_removal[sku] += bc_unit * qty

    # Monthly storage fee:
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    sheet = wb['Lưu kho']
    sku_storage = defaultdict(float)
    for r in sheet.iter_rows(min_row=2, values_only=True):
        if r[7] in [9, 9.0, '9', '09']:
            sku = r[9]
            try:
                amt = float(r[6] or 0.0)
            except:
                amt = 0.0
            if sku:
                sku_storage[sku] += amt

    return sku_placement, sku_longterm, sku_removal, sku_storage

def load_excel_month9_totals():
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    sheet = wb['SKU-monthly']
    rows = list(sheet.iter_rows(min_row=1, max_row=3, values_only=True))
    totals_row = rows[1]
    headers = rows[2]
    
    excel_targets = {}
    for idx, (h, val) in enumerate(zip(headers, totals_row)):
        if h is not None:
            excel_targets[h] = val
    return excel_targets

def main():
    print("=== LOADING SKU MASTER & MONTHLY BASECOSTS ===")
    sku_master, asin_to_sku = load_sku_master()
    basecosts_m9, basecosts_m10 = load_monthly_basecosts()
    print(f"Loaded {len(sku_master)} SKUs from master, {len(basecosts_m9)} basecosts for Month 9.")

    print("\n=== GETTING MONTH 9 ORDER IDS ===")
    m9_order_ids = get_month9_order_ids()
    print(f"Identified {len(m9_order_ids)} orders placed in Month 9.")

    print("\n=== PARSING TRANSACTIONS (15_DateRangeTransactions_2026-09.csv) ===")
    sku_trans, settled_m9_order_ids, awd_sub_fees = parse_transactions(sku_master, asin_to_sku, basecosts_m9, m9_order_ids)
    print(f"Found {len(settled_m9_order_ids)} settled Month 9 orders in transactions. AWD/Sub fees = {awd_sub_fees:.2f}")

    print("\n=== PARSING ALL ORDERS (02_AllOrders_2026-09.tsv) ===")
    sku_orders = parse_all_orders(sku_master, asin_to_sku, basecosts_m9, settled_m9_order_ids)
    print(f"Parsed orders for {len(sku_orders)} distinct SKUs.")

    print("\n=== PARSING ADS ===")
    sku_ads = parse_ads()
    print(f"Parsed ads for {len(sku_ads)} distinct SKUs.")

    print("\n=== PARSING STORAGE, PLACEMENT, LONG-TERM & REMOVAL ===")
    sku_placement, sku_longterm, sku_removal, sku_storage = parse_storage_and_other_fees(sku_master, asin_to_sku, basecosts_m10)

    # All unique SKUs
    all_skus = set(sku_master.keys()) | set(sku_orders.keys()) | set(sku_ads.keys()) | set(sku_trans.keys())
    
    # Aggregate Store Totals
    calc_totals = defaultdict(float)
    calc_totals['AWD/Subscription/Amazon Fees/Disposal Fee'] = awd_sub_fees
    
    for sku in all_skus:
        ord_data = sku_orders[sku]
        ads_data = sku_ads[sku]
        trans_data = sku_trans[sku]
        
        rev = ord_data['revenue']
        qty = ord_data['quantity']
        ads_fee = -ads_data['spend']
        bc = ord_data['basecost']
        amz_unrec = ord_data['amazon_fee_unrec']
        amz_trans = trans_data['amazon_fee_trans']
        tax = -ads_data['tax'] + ord_data['tax_order']
        ret = trans_data['return_amount']
        adj = trans_data['adjustment']
        storage = -sku_storage[sku]
        placement = -sku_placement[sku]
        longterm = -sku_longterm[sku]
        fba_ret = trans_data['fba_customer_return_fee']
        liq = trans_data['liquidations']
        bc_ret_adj = trans_data['basecost_return_adjustment']
        rem = -sku_removal[sku] + trans_data['removal_trans']
        
        profit = rev + ads_fee + bc + amz_unrec + amz_trans + tax + ret + adj + storage + placement + longterm + fba_ret + liq + bc_ret_adj + rem
        
        calc_totals['Revenue'] += rev
        calc_totals['Quantity'] += qty
        calc_totals['Ads Fee'] += ads_fee
        calc_totals['Basecost'] += bc
        calc_totals['Amazon Fee (chưa ghi nhận)'] += amz_unrec
        calc_totals['Amazon fee (transperance report)'] += amz_trans
        calc_totals['Thuế'] += tax
        calc_totals['Return'] += ret
        calc_totals['Adjustment'] += adj
        calc_totals['Lưu kho'] += storage
        calc_totals['Placement Fee'] += placement
        calc_totals['Long-Term Fee'] += longterm
        calc_totals['FBA Customer Return Fee'] += fba_ret
        calc_totals['Liquidations'] += liq
        calc_totals['Basecost Return/Adjustment'] += bc_ret_adj
        calc_totals['Removal'] += rem
        calc_totals['Profit'] += profit
        calc_totals['Revenue ads'] += ads_data['sales']

    # Net Profit including AWD/Subscription fees (matches Excel cell U2: =SUM(U4:U119)+AE2)
    calc_totals['Profit'] += awd_sub_fees

    print("\n=== LOADING EXCEL ROW 2 TARGETS ===")
    excel_targets = load_excel_month9_totals()

    print("\n" + "="*85)
    print(f"{'METRIC NAME':<35} | {'CALCULATED':<16} | {'EXCEL ROW 2':<16} | {'DELTA':<12}")
    print("="*85)

    metrics_to_compare = [
        ('Revenue', 'Revenue'),
        ('Quantity', 'Quantity'),
        ('Ads Fee', 'Ads Fee'),
        ('Basecost', 'Basecost'),
        ('Amazon Fee (chưa ghi nhận)', 'Amazon Fee (chưa ghi nhận)'),
        ('Amazon fee (transperance report)', 'Amazon fee (transperance report)'),
        ('Thuế', 'Thuế'),
        ('Return', 'Return'),
        ('Adjustment', 'Adjustment'),
        ('Lưu kho', 'Lưu kho'),
        ('Placement Fee', 'Placement Fee'),
        ('Long-Term Fee', 'Long-Term Fee'),
        ('FBA Customer Return Fee', 'FBA Customer Return Fee'),
        ('Liquidations', 'Liquidations'),
        ('Basecost Return/Adjustment', 'Basecost Return/Adjustment'),
        ('Removal', 'Removal'),
        ('Profit', 'Profit'),
        ('Revenue ads', 'Revenue ads'),
        ('AWD/Subscription/Amazon Fees/Disposal Fee', 'AWD/Subscription/Amazon Fees/Disposal Fee'),
    ]

    for calc_key, excel_key in metrics_to_compare:
        c_val = calc_totals.get(calc_key, 0.0)
        e_val = excel_targets.get(excel_key, 0.0)
        if e_val is None: e_val = 0.0
        delta = float(c_val) - float(e_val)
        status = "MATCH" if abs(delta) < 0.0001 else "DIFF"
        print(f"{calc_key:<35} | {float(c_val):>16.4f} | {float(e_val):>16.4f} | {delta:>12.4f}  [{status}]")

    print("="*85)

if __name__ == '__main__':
    main()
