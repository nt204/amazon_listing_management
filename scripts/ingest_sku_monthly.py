#!/usr/bin/env python3
import sys, os, time, psycopg2
from decimal import Decimal
from collections import defaultdict
import openpyxl

def main():
    start_time = time.time()
    excel_path = os.getenv("EXCEL_PATH", "/Users/macbook/Downloads/TỔNG KẾT CUỐI THÁNG_WARMSTOREY 2026.xlsx")
    db_url = os.getenv("DATABASE_URL", "postgresql://listing_desk:listing_desk@localhost:2412/listing_desk")
    
    if not os.path.exists(excel_path):
        print(f"Error: Excel file not found at {excel_path}")
        sys.exit(1)
        
    print(f"Connecting to Postgres at {db_url}...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # 1. Get Store ID for WARMSTOREY
    cur.execute("SELECT id, name FROM stores WHERE UPPER(name) = 'WARMSTOREY' LIMIT 1;")
    row = cur.fetchone()
    if not row:
        print("Error: Store WARMSTOREY not found in stores table.")
        sys.exit(1)
    store_id = row[0]
    store_name = row[1]
    print(f"Target Store: {store_name} ({store_id})")
    
    # 2. Get mockup URLs from accounting_sku_master across all stores as fallback
    cur.execute("SELECT sku, mockup_url, mockup FROM accounting_sku_master WHERE mockup_url IS NOT NULL OR mockup IS NOT NULL;")
    mockup_map = {}
    for r in cur.fetchall():
        if r[0]:
            mockup_map[r[0].strip().upper()] = r[1] or r[2]
    print(f"Loaded {len(mockup_map)} mockups from database.")
    
    # 3. Load Excel workbook streaming
    print(f"Loading Excel workbook {excel_path} (read_only=True)...")
    wb = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
    
    # 4. Sheet BẢNG MÃ
    print("Parsing sheet BẢNG MÃ...")
    ws_bm = wb['BẢNG MÃ']
    sku_catalog = {} # sku -> dict
    asin_to_sku = {}
    fnsku_to_sku = {}
    
    for r in ws_bm.iter_rows(values_only=True):
        if not r or r[0] == 'Brand': continue
        brand = str(r[0]).strip() if r[0] else ''
        loai = str(r[9]).strip() if len(r) > 9 and r[9] else ''
        sku = str(r[3]).strip() if len(r) > 3 and r[3] else ''
        if not sku: continue
        if brand.upper() == 'WARMSTOREY' and loai.upper() == 'FBA':
            asin = str(r[4]).strip() if len(r) > 4 and r[4] else ''
            fnsku = str(r[5]).strip() if len(r) > 5 and r[5] else ''
            product_type = str(r[1]).strip() if r[1] else ''
            status = str(r[12]).strip() if len(r) > 12 and r[12] else ''
            mockup_url = mockup_map.get(sku.upper()) or (str(r[2]).strip() if len(r) > 2 and r[2] and str(r[2]).startswith('http') else None)
            
            sku_catalog[sku] = {
                'product_type': product_type,
                'asin': asin,
                'fnsku': fnsku,
                'pic_mkt': str(r[8]).strip() if len(r) > 8 and r[8] else '',
                'niche': str(r[10]).strip() if len(r) > 10 and r[10] else '',
                'status': status,
                'mockup_url': mockup_url,
            }
            if asin and asin not in asin_to_sku: asin_to_sku[asin] = sku
            if fnsku and fnsku not in fnsku_to_sku: fnsku_to_sku[fnsku] = sku
            
    print(f"Loaded {len(sku_catalog)} FBA SKUs for WARMSTOREY.")
    
    # Aggregators by (month, sku)
    basecost_agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    ads_agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    storage_agg = defaultdict(lambda: defaultdict(float))
    placement_agg = defaultdict(lambda: defaultdict(float))
    longterm_agg = defaultdict(lambda: defaultdict(float))
    removal_rp_agg = defaultdict(lambda: defaultdict(float))
    trans_agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    account_fees = defaultdict(lambda: defaultdict(float)) # m -> {awd_sub, vat_tax}
    
    # 5. Sheet Basecost
    print("Parsing sheet Basecost...")
    for r in wb['Basecost'].iter_rows(values_only=True):
        if not r or r[0] == 'Month' or r[0] is None: continue
        try: m = int(float(r[0]))
        except: continue
        sku = str(r[3]).strip() if len(r) > 3 and r[3] else ''
        if not sku: continue
        rev = float(r[11] or 0)
        qty = float(r[12] or 0) if (len(r) > 12 and r[12] is not None and str(r[12]).strip() != '') else 0.0
        bc = float(r[20] or 0) if len(r) > 20 else 0.0
        thue = float(r[16] or 0) if len(r) > 16 else 0.0
        unrec = float(r[15] or 0) if (len(r) > 23 and str(r[23]).strip() == 'Chưa ghi nhận') else 0.0
        
        d = basecost_agg[m][sku]
        d['rev'] += rev
        d['qty'] += qty
        d['basecost'] += bc
        d['thue_order'] += thue
        d['amz_fee_unrec'] += unrec
        
    # 6. Sheet Ads
    print("Parsing sheet Ads...")
    for r in wb['Ads'].iter_rows(values_only=True):
        if not r or r[0] == 'Date' or r[0] is None: continue
        try: m = int(float(r[0]))
        except: continue
        sku = str(r[23]).strip() if len(r) > 23 and r[23] else ''
        if not sku and len(r) > 1 and r[1]:
            sku = str(r[1]).strip().split()[-1]
        if not sku: continue
        spend = float(r[11] or 0) if len(r) > 11 else 0.0
        sales = float(r[14] or 0) if len(r) > 14 else 0.0
        thue_ads = float(r[29] or 0) if len(r) > 29 else 0.0
        
        d = ads_agg[m][sku]
        d['ads_fee'] -= spend
        d['rev_ads'] += sales
        d['thue_ads'] -= thue_ads
        
    # 7. Sheet Lưu kho
    print("Parsing sheet Lưu kho...")
    for r in wb['Lưu kho'].iter_rows(values_only=True):
        if not r or r[7] == 'THÁNG' or r[7] is None: continue
        try: m = int(float(r[7]))
        except: continue
        sku = str(r[9]).strip() if len(r) > 9 and r[9] else ''
        fee = float(r[6] or 0) if len(r) > 6 else 0.0
        if sku:
            storage_agg[m][sku] -= fee
            
    # 8. Sheet Placement
    print("Parsing sheet Placement...")
    for r in wb['Placement'].iter_rows(values_only=True):
        if not r or r[22] == 'Month' or r[22] is None: continue
        try: m = int(float(r[22]))
        except: continue
        asin = str(r[5]).strip() if len(r) > 5 and r[5] else ''
        fee = float(r[21] or 0) if len(r) > 21 else 0.0
        if asin:
            placement_agg[m][asin] -= fee
            
    # 9. Sheet Long-Term
    print("Parsing sheet Long-Term...")
    for r in wb['Long-Term'].iter_rows(values_only=True):
        if not r or r[14] == 'Month' or r[14] is None: continue
        try: m = int(float(r[14]))
        except: continue
        asin = str(r[3]).strip() if len(r) > 3 and r[3] else ''
        fee = float(r[11] or 0) if len(r) > 11 else 0.0
        if asin:
            longterm_agg[m][asin] -= fee
            
    # 10. Sheet Removal RP
    print("Parsing sheet Removal RP...")
    for r in wb['Removal RP'].iter_rows(values_only=True):
        if not r or len(r) <= 20 or r[20] is None or r[20] == 'Month': continue
        try: m = int(float(r[20]))
        except: continue
        sku = str(r[6]).strip() if len(r) > 6 and r[6] else ''
        fee = float(r[18] or 0) if len(r) > 18 else 0.0
        if sku:
            removal_rp_agg[m][sku] -= fee
            
    # 11. Sheet Trans Rp
    print("Parsing sheet Trans Rp...")
    for r in wb['Trans Rp'].iter_rows(values_only=True):
        if not r or r[0] == 'date/time' or r[0] is None: continue
        
        m_val = r[30] if len(r) > 30 else None
        tr_type = str(r[2]).strip() if len(r) > 2 and r[2] else ''
        sku = str(r[4]).strip() if len(r) > 4 and r[4] else ''
        desc = str(r[5]).strip() if len(r) > 5 and r[5] else ''
        total = float(r[29] or 0) if len(r) > 29 else 0.0
        bc_tr = float(r[32] or 0) if len(r) > 32 else 0.0
        amz_fee_order = float(r[38] or 0) if len(r) > 38 else 0.0
        m_ai = r[34] if len(r) > 34 else None
        asin_tr = str(r[39]).strip() if len(r) > 39 and r[39] else ''
        sku_ao = str(r[40]).strip() if len(r) > 40 and r[40] else ''
        sku_ap = str(r[41]).strip() if len(r) > 41 and r[41] else ''
        
        # Amazon fee for Order is indexed by Col AI (34)
        if tr_type == 'Order' and sku and m_ai is not None:
            try:
                m_order = int(float(m_ai))
                trans_agg[m_order][sku]['amz_fee_trans'] += amz_fee_order
            except: pass
            
        if m_val is None: continue
        try: m = int(float(m_val))
        except: continue
        
        if tr_type == 'Refund' and sku:
            trans_agg[m][sku]['refund'] += total
            trans_agg[m][sku]['bc_ret_adj'] += bc_tr
        elif tr_type == 'Adjustment' and sku:
            trans_agg[m][sku]['adj'] += total
            trans_agg[m][sku]['bc_ret_adj'] += bc_tr
            trans_agg[m][sku]['bc_adj'] += bc_tr
        elif tr_type == 'Fee Adjustment' and sku_ap:
            trans_agg[m][sku_ap]['adj'] += total
            
        if 'FBA Customer Return' in tr_type:
            if sku in fnsku_to_sku:
                trans_agg[m][fnsku_to_sku[sku]]['fba_ret'] += total
            elif asin_tr and asin_tr in asin_to_sku:
                trans_agg[m][asin_to_sku[asin_tr]]['fba_ret'] += total
            elif sku in sku_catalog:
                trans_agg[m][sku]['fba_ret'] += total
        elif 'FBA Customer Return' in desc and sku in sku_catalog:
            trans_agg[m][sku]['fba_ret'] += total
            
        if tr_type == 'Liquidations':
            if sku in fnsku_to_sku:
                trans_agg[m][fnsku_to_sku[sku]]['liq'] += total
            elif sku in sku_catalog:
                trans_agg[m][sku]['liq'] += total
                
        if sku_ao:
            trans_agg[m][sku_ao]['removal_tr'] += total
            
        if tr_type == 'FBA Transaction fees' and 'AWD' in desc:
            account_fees[m]['awd_sub'] += total
        elif desc == 'Subscription':
            account_fees[m]['awd_sub'] += total
        elif tr_type == 'Amazon Fees':
            account_fees[m]['awd_sub'] += total
        elif 'Removal' in desc and not sku_ao:
            account_fees[m]['awd_sub'] += total
        elif desc == 'Other':
            account_fees[m]['vat_tax'] += total

    # 12. Sheet SKU-monthly (Ground truth for Month 9 available inventory)
    available_inv_map = {}
    ws_m9 = wb['SKU-monthly']
    for r in ws_m9.iter_rows(values_only=True):
        if r and len(r) > 21 and r[2] and r[2] != 'SKU':
            sku_str = str(r[2]).strip()
            inv_val = r[21]
            try: available_inv_map[sku_str] = int(inv_val or 0)
            except: pass
            
    wb.close()
    print("Finished reading all sheets. Now computing months 1 to 9...")

    all_months = range(1, 10) # 1 through 9
    total_sku_rows = 0
    
    for m in all_months:
        m_sku_rows = []
        
        sum_rev = 0.0
        sum_qty = 0
        sum_ads = 0.0
        sum_bc = 0.0
        sum_amz_unrec = 0.0
        sum_amz_trans = 0.0
        sum_thue = 0.0
        sum_refund = 0.0
        sum_adj = 0.0
        sum_storage = 0.0
        sum_placement = 0.0
        sum_longterm = 0.0
        sum_fba_ret = 0.0
        sum_liq = 0.0
        sum_bc_ret_adj = 0.0
        sum_removal = 0.0
        sum_profit = 0.0
        sum_inv = 0
        sum_rev_ads = 0.0
        active_count = 0
        
        for sku, cat in sku_catalog.items():
            asin = cat['asin']
            product_type = cat['product_type']
            mockup_url = cat['mockup_url']
            status = cat['status']
            fnsku = cat['fnsku']
            
            b_data = basecost_agg[m][sku]
            a_data = ads_agg[m][sku]
            t_data = trans_agg[m][sku]
            
            rev = b_data['rev']
            qty = int(round(b_data['qty']))
            ads_fee = a_data['ads_fee']
            bc = b_data['basecost']
            amz_unrec = b_data['amz_fee_unrec']
            amz_trans = t_data['amz_fee_trans']
            thue = a_data['thue_ads'] + b_data['thue_order']
            ret_amount = t_data['refund']
            adj = t_data['adj']
            st_fee = storage_agg[m][sku]
            pl_fee = placement_agg[m][asin] if asin else 0.0
            lt_fee = longterm_agg[m][asin] if asin else 0.0
            fba_ret_fee = t_data['fba_ret']
            liq = t_data['liq']
            bc_ret_adj = t_data['bc_ret_adj']
            removal = removal_rp_agg[m][sku] + t_data['removal_tr']
            
            # Profit = Revenue + Ads Fee + Basecost + Amazon Fees + Thuế + Refund + Adjustment + Lưu kho + Placement + LongTerm + FBA Ret + Liq + BC Ret/Adj + Removal
            profit = (
                rev
                + ads_fee
                + bc
                + amz_unrec
                + amz_trans
                + thue
                + ret_amount
                + adj
                + st_fee
                + pl_fee
                + lt_fee
                + fba_ret_fee
                + liq
                + bc_ret_adj
                + removal
            )
            
            inv = available_inv_map.get(sku, 0) if m == 9 else 0
            rev_ads = a_data['rev_ads']
            
            tacos = (ads_fee / rev) if rev > 0 else None
            acos = (ads_fee / rev_ads) if rev_ads > 0 else None
            margin = (profit / rev) if rev > 0 else None
            roi = (-profit / bc) if bc < 0 else None
            profit_per_item = (profit / qty) if qty > 0 else None
            bc_per_item = (bc / qty) if qty > 0 else None
            
            if rev > 0 or qty > 0 or ads_fee != 0 or profit != 0 or st_fee != 0:
                active_count += 1
                
            sum_rev += rev
            sum_qty += qty
            sum_ads += ads_fee
            sum_bc += bc
            sum_amz_unrec += amz_unrec
            sum_amz_trans += amz_trans
            sum_thue += thue
            sum_refund += ret_amount
            sum_adj += adj
            sum_storage += st_fee
            sum_placement += pl_fee
            sum_longterm += lt_fee
            sum_fba_ret += fba_ret_fee
            sum_liq += liq
            sum_bc_ret_adj += bc_ret_adj
            sum_removal += removal
            sum_profit += profit
            sum_inv += inv
            sum_rev_ads += rev_ads
            
            m_sku_rows.append((
                store_id, 2026, m, sku, asin, product_type, mockup_url, fnsku, status,
                rev, qty, ads_fee, bc, amz_unrec, amz_trans, thue, ret_amount, adj,
                st_fee, pl_fee, lt_fee, fba_ret_fee, liq, bc_ret_adj, removal, profit,
                inv, tacos, acos, margin, roi, profit_per_item, bc_per_item,
                0.0, 0, 0.0, t_data['bc_adj'], rev_ads
            ))
        sum_bc_adj_total = sum(trans_agg[m][s]['bc_adj'] for s in sku_catalog.keys())
        awd_fee = account_fees[m]['awd_sub']
        vat_tax = account_fees[m]['vat_tax']
        net_profit = sum_profit + awd_fee
        
        sum_tacos = (sum_ads / sum_rev) if sum_rev > 0 else None
        sum_acos = (sum_ads / sum_rev_ads) if sum_rev_ads > 0 else None
        sum_margin = (net_profit / sum_rev) if sum_rev > 0 else None
        # Excel cell Z2 formula: =iferror(U2/H2,"") which is Profit / Basecost (negative number)
        sum_roi = (net_profit / sum_bc) if sum_bc != 0 else None
        
        # Upsert SKU records
        insert_sku_sql = """
        INSERT INTO accounting_sku_monthly (
            store_id, year, month, sku, asin, product_type, mockup_url, fnsku, status,
            revenue, quantity, ads_fee, basecost, amazon_fee_unrecognized, amazon_fee_trans,
            thue, return_amount, adjustment, storage_fee, placement_fee, long_term_fee,
            fba_customer_return_fee, liquidations, basecost_return_adjustment, removal, profit,
            available_now, tacos, acos, margin, roi, profit_per_item, basecost_per_item,
            vat_tax_adjustment, removal_qty_2024, awd_subscription_fees, basecost_adjustment, revenue_ads,
            updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            NOW()
        )
        ON CONFLICT (store_id, year, month, sku) DO UPDATE SET
            asin = EXCLUDED.asin,
            product_type = EXCLUDED.product_type,
            mockup_url = EXCLUDED.mockup_url,
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
            removal = EXCLUDED.removal,
            profit = EXCLUDED.profit,
            available_now = EXCLUDED.available_now,
            tacos = EXCLUDED.tacos,
            acos = EXCLUDED.acos,
            margin = EXCLUDED.margin,
            roi = EXCLUDED.roi,
            profit_per_item = EXCLUDED.profit_per_item,
            basecost_per_item = EXCLUDED.basecost_per_item,
            vat_tax_adjustment = EXCLUDED.vat_tax_adjustment,
            removal_qty_2024 = EXCLUDED.removal_qty_2024,
            awd_subscription_fees = EXCLUDED.awd_subscription_fees,
            basecost_adjustment = EXCLUDED.basecost_adjustment,
            revenue_ads = EXCLUDED.revenue_ads,
            updated_at = NOW();
        """
        # Clean up any invalid or obsolete SKUs for this month
        cur.execute(
            "DELETE FROM accounting_sku_monthly WHERE store_id = %s AND year = 2026 AND month = %s AND sku NOT IN %s",
            (store_id, m, tuple(sku_catalog.keys()))
        )
        cur.executemany(insert_sku_sql, m_sku_rows)
        total_sku_rows += len(m_sku_rows)
        
        # Upsert Summary record
        insert_summary_sql = """
        INSERT INTO accounting_monthly_store_summary (
            store_id, year, month,
            total_revenue, total_quantity, total_ads_fee, total_basecost,
            total_amazon_fee_unrecognized, total_amazon_fee_trans, total_thue,
            total_return_amount, total_adjustment, total_storage_fee,
            total_placement_fee, total_long_term_fee, total_fba_customer_return_fee,
            total_liquidations, total_basecost_return_adj, total_removal,
            vat_tax_adjustment, awd_subscription_fees, basecost_adjustment,
            total_sku_profit, net_profit, total_available_now, total_revenue_ads,
            tacos, acos, margin, roi, active_sku_count, total_sku_count,
            updated_at
        ) VALUES (
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            NOW()
        )
        ON CONFLICT (store_id, year, month) DO UPDATE SET
            total_revenue = EXCLUDED.total_revenue,
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
            total_removal = EXCLUDED.total_removal,
            vat_tax_adjustment = EXCLUDED.vat_tax_adjustment,
            awd_subscription_fees = EXCLUDED.awd_subscription_fees,
            basecost_adjustment = EXCLUDED.basecost_adjustment,
            total_sku_profit = EXCLUDED.total_sku_profit,
            net_profit = EXCLUDED.net_profit,
            total_available_now = EXCLUDED.total_available_now,
            total_revenue_ads = EXCLUDED.total_revenue_ads,
            tacos = EXCLUDED.tacos,
            acos = EXCLUDED.acos,
            margin = EXCLUDED.margin,
            roi = EXCLUDED.roi,
            active_sku_count = EXCLUDED.active_sku_count,
            total_sku_count = EXCLUDED.total_sku_count,
            updated_at = NOW();
        """
        cur.execute(insert_summary_sql, (
            store_id, 2026, m,
            sum_rev, sum_qty, sum_ads, sum_bc,
            sum_amz_unrec, sum_amz_trans, sum_thue,
            sum_refund, sum_adj, sum_storage,
            sum_placement, sum_longterm, sum_fba_ret,
            sum_liq, sum_bc_ret_adj, sum_removal,
            vat_tax, awd_fee, sum_bc_adj_total,
            sum_profit, net_profit, sum_inv, sum_rev_ads,
            sum_tacos, sum_acos, sum_margin, sum_roi,
            active_count, len(sku_catalog)
        ))
        
        print(f"Month {m:02d}: {len(m_sku_rows)} SKUs ({active_count} active) | Rev: ${sum_rev:10.2f} | Profit: ${net_profit:9.2f}")
        
    conn.commit()
    conn.close()
    
    elapsed = time.time() - start_time
    print(f"\nIngestion successfully completed in {elapsed:.2f}s!")
    print(f"Total SKU monthly records upserted: {total_sku_rows}")
    print("Database is ready with exact monthly reports for Months 1 through 9!")

if __name__ == '__main__':
    main()
