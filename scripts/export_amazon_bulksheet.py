#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Export Amazon Bulksheet using the official Amazon blank template:
templates/ppc/AdvertisingBulksheetTemplate-seller.xlsx
"""

import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")
import openpyxl

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx")

def export_bulksheet(recommendations, output_path=None):
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Official Amazon template not found at {TEMPLATE_PATH}")

    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    ws = wb["Sponsored Products Campaigns"]
    headers = {str(cell.value).strip(): cell.column for cell in ws[1] if cell.value}

    for rec in recommendations:
        rec_type = rec.get("recType", "")
        target_type = rec.get("targetType", "EXACT")
        rec_bid = rec.get("recommendedBid")
        
        is_product_target = target_type == "PRODUCT"
        entity = "Product Targeting" if is_product_target else "Keyword"
        operation = "Update"
        match_type = ""
        state = "enabled"
        bid_val = ""

        if rec_type == "NEGATIVE_KEYWORD":
            entity = "Negative Product Targeting" if is_product_target else "Negative Keyword"
            operation = "Create"
            match_type = "negativeExact"
            state = "enabled"
            bid_val = ""
        elif rec_type in ("BID_DECREASE", "BID_INCREASE"):
            entity = "Product Targeting" if is_product_target else "Keyword"
            operation = "Update"
            source_match_type = str(rec.get("matchType") or "").strip().lower()
            match_type = source_match_type if source_match_type in ("exact", "phrase", "broad") else ""
            state = "enabled"
            bid_val = round(float(rec_bid), 2) if rec_bid is not None else ""
        elif rec_type == "PAUSE_TARGET":
            entity = "Product Targeting" if is_product_target else "Keyword"
            operation = "Update"
            source_match_type = str(rec.get("matchType") or "").strip().lower()
            match_type = source_match_type if source_match_type in ("exact", "phrase", "broad") else ""
            state = "paused"
            bid_val = round(float(rec_bid), 2) if rec_bid is not None else ""
        elif rec_type == "HARVEST_KEYWORD":
            entity = "Product Targeting" if is_product_target else "Keyword"
            operation = "Create"
            match_type = "exact"
            state = "enabled"
            bid_val = round(float(rec_bid), 2) if rec_bid is not None else 1.00

        values = {
            "Product": "Sponsored Products",
            "Entity": entity,
            "Operation": operation,
            "Campaign ID": str(rec.get("campaignId") or ""),
            "Ad Group ID": str(rec.get("adGroupId") or ""),
            "Keyword ID": str(rec.get("keywordId") or "") if not is_product_target and operation == "Update" else "",
            "Product Targeting ID": str(rec.get("keywordId") or "") if is_product_target and operation == "Update" else "",
            "Campaign Name": rec.get("campaignName") or "",
            "Ad Group Name": rec.get("adGroupName") or "",
            "State": state,
            "Bid": bid_val,
            "Keyword Text": "" if is_product_target else rec.get("keyword", ""),
            "Match Type": "" if is_product_target else match_type,
            "Product Targeting Expression": rec.get("keyword", "") if is_product_target else "",
        }
        row_number = ws.max_row + 1
        for header, value in values.items():
            column = headers.get(header)
            if column:
                ws.cell(row=row_number, column=column, value=value)

    if output_path:
        wb.save(output_path)
    else:
        # Save to stdout as binary
        import io
        buf = io.BytesIO()
        wb.save(buf)
        sys.stdout.buffer.write(buf.getvalue())

if __name__ == "__main__":
    if len(sys.argv) > 2:
        input_json_path = sys.argv[1]
        output_xlsx_path = sys.argv[2]
        with open(input_json_path, "r", encoding="utf-8") as f:
            recs = json.load(f)
        export_bulksheet(recs, output_xlsx_path)
    else:
        # Read from stdin
        raw = sys.stdin.read()
        recs = json.loads(raw) if raw else []
        export_bulksheet(recs)
