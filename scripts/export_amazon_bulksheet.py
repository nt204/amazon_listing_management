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

    for rec in recommendations:
        rec_type = rec.get("recType", "")
        target_type = rec.get("targetType", "EXACT")
        rec_bid = rec.get("recommendedBid")
        
        entity = "Keyword"
        operation = "Update"
        match_type = "Exact"
        state = "enabled"
        bid_val = ""

        if rec_type == "NEGATIVE_KEYWORD":
            entity = "Negative Keyword"
            operation = "Create"
            match_type = "Negative Exact"
            state = "enabled"
            bid_val = ""
        elif rec_type in ("BID_DECREASE", "BID_INCREASE"):
            entity = "Keyword"
            operation = "Update"
            match_type = "Exact"
            state = "enabled"
            bid_val = round(float(rec_bid), 2) if rec_bid is not None else ""
        elif rec_type == "HARVEST_KEYWORD":
            entity = "Keyword"
            operation = "Create"
            match_type = "Exact"
            state = "enabled"
            bid_val = round(float(rec_bid), 2) if rec_bid is not None else 1.00

        # Official Amazon template columns (32 columns):
        # 1: Product, 2: Entity, 3: Operation, 4: Campaign ID, 5: Ad Group ID, 6: Portfolio ID,
        # 7: Ad ID, 8: Keyword ID, 9: Product Targeting ID, 10: Campaign Name, 11: Ad Group Name,
        # 12: Start Date, 13: End Date, 14: Targeting Type, 15: State, 16: Daily Budget, 17: SKU,
        # 18: Ad Group Default Bid, 19: Bid, 20: Keyword Text, 21: Native Language Keyword,
        # 22: Native Language Locale, 23: Match Type, 24: Bidding Strategy, 25: Placement,
        # 26: Percentage, 27: Product Targeting Expression, 28: Audience ID,
        # 29: Shopper Cohort Percentage, 30: Shopper Cohort Type, 31: Sites, 32: Off-Amazon ad serving
        row = [
            "Sponsored Products",                       # 1: Product
            entity,                                     # 2: Entity
            operation,                                  # 3: Operation
            str(rec.get("campaignId") or ""),           # 4: Campaign ID
            str(rec.get("adGroupId") or ""),            # 5: Ad Group ID
            "",                                         # 6: Portfolio ID
            "",                                         # 7: Ad ID
            str(rec.get("keywordId") or "") if entity == "Keyword" else "", # 8: Keyword ID
            "",                                         # 9: Product Targeting ID
            rec.get("campaignName") or "",              # 10: Campaign Name
            rec.get("adGroupName") or "",               # 11: Ad Group Name
            "",                                         # 12: Start Date
            "",                                         # 13: End Date
            "",                                         # 14: Targeting Type
            state,                                      # 15: State
            "",                                         # 16: Daily Budget
            "",                                         # 17: SKU
            "",                                         # 18: Ad Group Default Bid
            bid_val,                                    # 19: Bid
            rec.get("keyword", ""),                     # 20: Keyword Text
            "",                                         # 21: Native Language Keyword
            "",                                         # 22: Native Language Locale
            match_type,                                 # 23: Match Type
            "",                                         # 24: Bidding Strategy
            "",                                         # 25: Placement
            "",                                         # 26: Percentage
            "",                                         # 27: Product Targeting Expression
            "",                                         # 28: Audience ID
            "",                                         # 29: Shopper Cohort Percentage
            "",                                         # 30: Shopper Cohort Type
            "",                                         # 31: Sites
            ""                                          # 32: Off-Amazon ad serving
        ]
        ws.append(row)

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
