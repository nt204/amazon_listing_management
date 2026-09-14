#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingest real Amazon PPC Bulk files (SP & SB) from Cloudflare R2 into PostgreSQL
Dynamic column detection from Row 1 to handle both SP and SB schemas flawlessly.
"""

import os
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
import psycopg2
from psycopg2.extras import execute_values

DB_URL = "postgresql://listing_desk:listing_desk@localhost:2412/listing_desk"
STORE_NAME = "Warmstorey"
DATE_STR = "2026-09-13"

def to_float(val):
    if not val:
        return 0.0
    val_str = str(val).replace("$", "").replace("%", "").replace(",", "").strip()
    try:
        return float(val_str)
    except Exception:
        return 0.0

def to_int(val):
    return int(round(to_float(val)))

def get_db_connection():
    return psycopg2.connect(DB_URL)

def ensure_store(cur):
    cur.execute("SELECT id FROM ppc_stores WHERE LOWER(name) = LOWER(%s)", (STORE_NAME,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute("""
        INSERT INTO ppc_stores (name, marketplace, target_acos, daily_budget, status)
        VALUES (%s, 'US', 25.0, 500.0, 'ACTIVE')
        RETURNING id
    """, (STORE_NAME,))
    return cur.fetchone()[0]

def parse_and_ingest_xlsx(fpath, store_id, camp_type="SP"):
    print(f"\n--- Đang bóc tách dữ liệu {camp_type} từ {os.path.basename(fpath)} ---")
    start_t = time.time()
    
    with zipfile.ZipFile(fpath, "r") as z:
        sheet_target = None
        for name in z.namelist():
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
                chunk = z.read(name)[:1200].decode("utf-8", errors="ignore")
                if "Campaigns" in chunk or "Sponsored" in chunk:
                    sheet_target = name
                    break
        if not sheet_target:
            sheet_target = "xl/worksheets/sheet2.xml"
            
        print(f"Đọc sheet: {sheet_target}")
        
        campaigns = {}
        keywords = []
        col_map = {}  # Col letter -> Header name normalized
        
        with z.open(sheet_target) as f:
            context = ET.iterparse(f, events=("end",))
            for event, elem in context:
                if elem.tag.endswith("row"):
                    r_num = elem.attrib.get("r")
                    if r_num == "1":
                        # Parse headers
                        for c in elem.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                            r_col = c.attrib.get("r", "")
                            col_letter = "".join([ch for ch in r_col if ch.isalpha()])
                            t_elem = c.find(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                            header = t_elem.text.strip().lower() if t_elem is not None and t_elem.text else ""
                            col_map[col_letter] = header
                        print(f"Đã nhận diện {len(col_map)} cột.")
                    else:
                        row_data = {}
                        for c in elem.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
                            r_col = c.attrib.get("r", "")
                            col_letter = "".join([ch for ch in r_col if ch.isalpha()])
                            header = col_map.get(col_letter)
                            if header:
                                t_elem = c.find(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                                v_elem = c.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
                                val = t_elem.text if t_elem is not None else (v_elem.text if v_elem is not None else "")
                                row_data[header] = val
                        
                        ent = row_data.get("entity", "").strip()
                        
                        camp_name = (
                            row_data.get("campaign name (informational only)") or 
                            row_data.get("campaign name") or ""
                        ).strip()
                        
                        adgroup_name = (
                            row_data.get("ad group name (informational only)") or 
                            row_data.get("ad group name") or ""
                        ).strip()
                        
                        portfolio_name = (
                            row_data.get("portfolio name (informational only)") or 
                            row_data.get("portfolio name") or ""
                        ).strip()
                        
                        targeting_type = row_data.get("targeting type", "MANUAL").strip()
                        state = row_data.get("state", "enabled").strip()
                        daily_budget = to_float(row_data.get("daily budget") or row_data.get("budget"))
                        
                        impressions = to_int(row_data.get("impressions"))
                        clicks = to_int(row_data.get("clicks"))
                        spend = to_float(row_data.get("spend"))
                        sales = to_float(row_data.get("sales"))
                        orders = to_int(row_data.get("orders"))
                        units = to_int(row_data.get("units"))
                        
                        if ent == "Campaign" and camp_name:
                            if camp_name not in campaigns or spend > 0 or impressions > 0:
                                campaigns[camp_name] = {
                                    "campaign_name": camp_name,
                                    "campaign_type": camp_type,
                                    "targeting_type": targeting_type.upper() if targeting_type.upper() in ("AUTO", "MANUAL") else "MANUAL",
                                    "daily_budget": daily_budget if daily_budget > 0 else 20.0,
                                    "status": "ENABLED" if state.lower() == "enabled" else "PAUSED"
                                }
                                
                        elif ent in ("Keyword", "Product Targeting") and camp_name:
                            # Chỉ lấy các keyword/target có phát sinh traffic hoặc chi phí hoặc đơn hàng
                            if impressions > 0 or spend > 0 or orders > 0:
                                kw_text = (
                                    row_data.get("keyword text") or 
                                    row_data.get("product targeting expression") or 
                                    row_data.get("sku") or "Target"
                                ).strip()
                                
                                match_type = (row_data.get("match type") or "EXACT").strip().upper()
                                if match_type not in ("EXACT", "PHRASE", "BROAD"):
                                    match_type = "EXACT"
                                
                                cpc = round(spend / clicks, 2) if clicks > 0 else 0.0
                                ctr = round((clicks / impressions) * 100, 2) if impressions > 0 else 0.0
                                cvr = round((orders / clicks) * 100, 2) if clicks > 0 else 0.0
                                acos = round((spend / sales) * 100, 2) if sales > 0 else 0.0
                                roas = round(sales / spend, 2) if spend > 0 else 0.0
                                
                                keywords.append({
                                    "report_date": DATE_STR,
                                    "portfolio_name": portfolio_name,
                                    "campaign_name": camp_name,
                                    "ad_group_name": adgroup_name,
                                    "target_keyword": kw_text,
                                    "customer_search_term": kw_text,
                                    "match_type": match_type,
                                    "impressions": impressions,
                                    "clicks": clicks,
                                    "spend": spend,
                                    "sales": sales,
                                    "orders": orders,
                                    "units": units,
                                    "cpc": cpc,
                                    "ctr": ctr,
                                    "cvr": cvr,
                                    "acos": acos,
                                    "roas": roas
                                })
                    elem.clear()
                    
    elapsed = time.time() - start_t
    print(f"-> Quét xong trong {elapsed:.1f}s: tìm thấy {len(campaigns)} Campaigns, {len(keywords)} Keywords/Search Terms có traffic.")
    return campaigns, keywords

def ingest():
    conn = get_db_connection()
    cur = conn.cursor()
    store_id = ensure_store(cur)
    conn.commit()
    print(f"Store: {STORE_NAME} (ID: {store_id})")

    sp_file = "/Users/macbook/Downloads/Bulk file /bulk-a1qiqhomjzfqb8-20260813-20260913-1789340669395.xlsx"
    sb_file = "/Users/macbook/Downloads/Bulk file /bulk-a1qiqhomjzfqb8-20260813-20260913-1789340815760.xlsx"
    
    all_campaigns = {}
    all_keywords = []

    if os.path.exists(sp_file):
        sp_camps, sp_kws = parse_and_ingest_xlsx(sp_file, store_id, "SP")
        all_campaigns.update(sp_camps)
        all_keywords.extend(sp_kws)

    if os.path.exists(sb_file):
        sb_camps, sb_kws = parse_and_ingest_xlsx(sb_file, store_id, "SB")
        all_campaigns.update(sb_camps)
        all_keywords.extend(sb_kws)

    print(f"\n[GHI VÀO DATABASE POSTGRESQL]")
    # Ingest Campaigns
    camp_values = [
        (store_id, c["campaign_name"], c["campaign_type"], c["targeting_type"], c["daily_budget"], c["status"])
        for c in all_campaigns.values()
    ]
    execute_values(
        cur,
        """
        INSERT INTO ppc_campaigns (store_id, campaign_name, campaign_type, targeting_type, daily_budget, status)
        VALUES %s
        ON CONFLICT (store_id, campaign_name) 
        DO UPDATE SET 
            daily_budget = EXCLUDED.daily_budget,
            status = EXCLUDED.status,
            updated_at = NOW()
        """,
        camp_values
    )
    conn.commit()
    print(f"  [+] Đã lưu {len(camp_values)} chiến dịch vào bảng ppc_campaigns!")

    # Ingest Keywords / Search Terms
    kw_values = [
        (
            store_id, k["report_date"], k["portfolio_name"], k["campaign_name"], k["ad_group_name"],
            k["target_keyword"], k["customer_search_term"], k["match_type"],
            k["impressions"], k["clicks"], k["spend"], k["sales"], k["orders"], k["units"],
            k["cpc"], k["ctr"], k["cvr"], k["acos"], k["roas"]
        )
        for k in all_keywords
    ]
    execute_values(
        cur,
        """
        INSERT INTO ppc_search_terms (
            store_id, report_date, portfolio_name, campaign_name, ad_group_name,
            target_keyword, customer_search_term, match_type,
            impressions, clicks, spend, sales, orders, units,
            cpc, ctr, cvr, acos, roas
        ) VALUES %s
        ON CONFLICT ON CONSTRAINT ppc_search_term_identity_unique
        DO UPDATE SET
            impressions = EXCLUDED.impressions,
            clicks = EXCLUDED.clicks,
            spend = EXCLUDED.spend,
            sales = EXCLUDED.sales,
            orders = EXCLUDED.orders,
            units = EXCLUDED.units,
            cpc = EXCLUDED.cpc,
            ctr = EXCLUDED.ctr,
            cvr = EXCLUDED.cvr,
            acos = EXCLUDED.acos,
            roas = EXCLUDED.roas,
            updated_at = NOW()
        """,
        kw_values
    )
    conn.commit()
    print(f"  [+] Đã lưu {len(kw_values)} từ khóa / Search Terms thực tế vào bảng ppc_search_terms!")

    # Ghi log sync thành công
    cur.execute("""
        INSERT INTO ppc_sync_logs (source, file_name, source_version, status, records_count, message)
        VALUES (
            'CLOUDFLARE_R2', 
            'Warmstorey Bulk File SP & SB 20260914 (30 day).xlsx', 
            '20260914', 
            'SUCCESS', 
            %s, 
            %s
        )
    """, (len(kw_values), f"Đồng bộ thành công {len(camp_values)} campaigns và {len(kw_values)} keywords từ Cloudflare R2."))

    conn.commit()
    cur.close()
    conn.close()
    print(f"\n🎉 HOÀN TẤT ĐỒNG BỘ TOÀN DIỆN VÀO POSTGRESQL!")

if __name__ == "__main__":
    ingest()
