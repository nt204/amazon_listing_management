#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Export Amazon Bulksheet for "Lên Camp Sale KW" (Sale KW Campaign Launch)
using the official Amazon blank template: templates/ppc/AdvertisingBulksheetTemplate-seller.xlsx
"""

import sys
import json
import os
import datetime
import warnings
warnings.filterwarnings("ignore")
import openpyxl
import re

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx"
)


def is_product_targeting_term(term):
    t = str(term or "").strip()
    if not t:
        return False
    lower_t = t.lower()
    if lower_t.startswith("asin=") or lower_t.startswith("category="):
        return True
    if re.fullmatch(r"[bB][0-9a-zA-Z]{9}", t):
        return True
    if lower_t.startswith("b0") and len(t) >= 10 and " " not in t:
        return True
    return False

def format_product_expression(term):
    t = str(term or "").strip()
    lower_t = t.lower()
    if lower_t.startswith("asin=") or lower_t.startswith("category="):
        return t
    asin = t.upper().replace('"', '').replace("'", "")
    return f'asin="{asin}"'

SB_KEYWORDS = (" SB", "SB0", "VIDEO", "BRANDS", "HSA")
SD_KEYWORDS = (" SD", "SD0", "DISPLAY", "TACTIC")


def detect_ad_type(explicit, camp_name):
    """Loại camp nguồn: SP / SB / SD (ưu tiên giá trị gửi lên, không có thì đoán theo tên camp)."""
    val = str(explicit or "").strip().upper()
    if val in ("SP", "SB", "SD"):
        return val
    name = " " + str(camp_name or "").upper()
    if any(k in name for k in SB_KEYWORDS):
        return "SB"
    if any(k in name for k in SD_KEYWORDS):
        return "SD"
    return "SP"


class SheetWriter:
    def __init__(self, ws):
        self.ws = ws
        self.headers = {str(cell.value).strip(): cell.column for cell in ws[1] if cell.value}
        self.row = ws.max_row + 1

    def write(self, values):
        for h, v in values.items():
            col = self.headers.get(h)
            if col and v is not None and str(v).strip() != "":
                self.ws.cell(row=self.row, column=col, value=v)
        self.row += 1


def to_bid(value, fallback):
    try:
        return round(float(value), 2) if value is not None else round(fallback, 2)
    except (ValueError, TypeError):
        return round(fallback, 2)


def write_sp_campaign(w, camp, today_str):
    target_camp_name = str(camp.get("targetCampaignName") or "").strip()
    ad_group_name = str(camp.get("adGroupName") or target_camp_name).strip()
    daily_budget = float(camp.get("dailyBudget") or 5.0)
    default_bid = float(camp.get("defaultBid") or 1.0)
    bidding_strategy = str(camp.get("biddingStrategy") or "Dynamic bids - down only").strip()
    skus_raw = camp.get("sku") or camp.get("skus") or []
    if isinstance(skus_raw, str):
        skus = [s.strip() for s in skus_raw.split(",") if s.strip()]
    else:
        skus = [str(s).strip() for s in skus_raw if str(s).strip()]
    ids = {"Product": "Sponsored Products", "Campaign ID": target_camp_name, "Campaign Name": target_camp_name}
    ag = {**ids, "Ad Group ID": ad_group_name, "Ad Group Name": ad_group_name}

    w.write({**ids, "Entity": "Campaign", "Operation": "Create", "Start Date": today_str, "Targeting Type": "MANUAL",
             "State": "enabled", "Daily Budget": round(daily_budget, 2), "Bidding Strategy": bidding_strategy})
    w.write({**ag, "Entity": "Ad Group", "Operation": "Create", "State": "enabled", "Ad Group Default Bid": round(default_bid, 2)})
    for s in skus:
        w.write({**ag, "Entity": "Product Ad", "Operation": "Create", "SKU": s, "State": "enabled"})

    for kw in camp.get("keywords", []):
        term = str(kw.get("customerSearchTerm") or kw.get("keyword") or "").strip()
        if not term:
            continue
        bid_val = to_bid(kw.get("bid"), default_bid)
        if is_product_targeting_term(term):
            w.write({**ag, "Entity": "Product Targeting", "Operation": "Create", "State": "enabled", "Bid": bid_val,
                     "Product Targeting Expression": format_product_expression(term)})
        else:
            match_t = str(kw.get("matchType") or "exact").strip().lower()
            w.write({**ag, "Entity": "Keyword", "Operation": "Create", "State": "enabled", "Bid": bid_val,
                     "Keyword Text": term, "Match Type": match_t if match_t in ("exact", "phrase", "broad") else "exact"})


def write_sb_campaign(w, camp, today_str):
    """SB01 Product Collection / SB05 Video (sheet Sponsored Brands Campaigns, như Lên Camp SKU Mới)."""
    name = str(camp.get("targetCampaignName") or "").strip()
    default_bid = float(camp.get("defaultBid") or 1.0)
    cr = camp.get("sbCreative") or {}
    row = {
        "Product": "Sponsored Brands", "Entity": "Campaign", "Operation": "Create",
        "Campaign ID": name, "Campaign Name": name, "Start Date": today_str, "State": "enabled",
        "Budget Type": "Daily", "Budget": round(float(camp.get("dailyBudget") or 5.0), 2), "Bid Optimization": "Auto",
        "Brand Entity ID": cr.get("brandEntityId"), "Brand Name": cr.get("brand"), "Creative ASINs": cr.get("creativeAsins"),
    }
    if str(camp.get("runType") or "").upper() == "SB05":
        row.update({"Ad Format": "Video", "Video Media IDs": cr.get("videoMediaIds"), "Creative Type": "Video"})
    else:
        row.update({"Ad Format": "Product Collection", "Landing Page URL": cr.get("landingPageUrl"),
                    "Brand Logo Asset ID": cr.get("brandLogoAssetId"), "Creative Headline": cr.get("creativeHeadline")})
    w.write(row)
    for kw in camp.get("keywords", []):
        term = str(kw.get("customerSearchTerm") or kw.get("keyword") or "").strip()
        if not term or is_product_targeting_term(term):
            continue
        match_t = str(kw.get("matchType") or "exact").strip().lower()
        w.write({"Product": "Sponsored Brands", "Entity": "Keyword", "Operation": "Create", "Campaign ID": name,
                 "Ad Group ID": name, "State": "enabled", "Bid": to_bid(kw.get("bid"), default_bid), "Keyword Text": term,
                 "Match Type": match_t if match_t in ("exact", "phrase", "broad") else "exact"})


def write_source_negative(writers, neg):
    """Negative Exact ở camp nguồn, đúng loại camp: SP (ad group / campaign), SB (ad group), SD bỏ qua."""
    term, ad_type = neg["term"], neg["adType"]
    is_product = is_product_targeting_term(term)
    camp_id, ag_id, camp_name, ag_name = neg["campaignId"], neg["adGroupId"], neg["campaignName"], neg["adGroupName"]
    if ad_type == "SD":
        return
    if ad_type == "SB":
        row = {"Product": "Sponsored Brands", "Entity": "Negative Product Targeting" if is_product else "Negative Keyword",
               "Operation": "Create", "Campaign ID": camp_id, "Ad Group ID": ag_id, "State": "enabled"}
        if is_product:
            row["Product Targeting Expression"] = format_product_expression(term)
        else:
            row.update({"Keyword Text": term, "Match Type": "negativeExact"})
        writers["SB"].write(row)
        return
    if is_product:
        entity = "Negative Product Targeting" if ag_id else "Campaign Negative Product Targeting"
    else:
        entity = "Negative Keyword" if ag_id else "Campaign Negative Keyword"
    row = {"Product": "Sponsored Products", "Entity": entity, "Operation": "Create", "Campaign ID": camp_id,
           "Ad Group ID": ag_id, "Campaign Name": camp_name, "Ad Group Name": ag_name if ag_id else "", "State": "enabled"}
    if is_product:
        row["Product Targeting Expression"] = format_product_expression(term)
    else:
        row.update({"Keyword Text": term, "Match Type": "negativeExact"})
    writers["SP"].write(row)


def export_sale_kw_bulksheet(data, output_path=None):
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Official Amazon template not found at {TEMPLATE_PATH}")

    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    writers = {
        "SP": SheetWriter(wb["Sponsored Products Campaigns"]),
        "SB": SheetWriter(wb["Sponsored Brands Campaigns"]),
    }
    today_str = datetime.datetime.now().strftime("%Y%m%d")
    campaigns = data.get("campaigns", []) if isinstance(data, dict) else data

    negatives = []
    seen_neg = set()
    for camp in campaigns:
        if not str(camp.get("targetCampaignName") or "").strip():
            continue
        if str(camp.get("adProduct") or "").upper() == "SB":
            write_sb_campaign(writers["SB"], camp, today_str)
        else:
            write_sp_campaign(writers["SP"], camp, today_str)

        if not bool(camp.get("negateInSource", False)):
            continue
        # Mỗi term phủ định đúng camp nguồn của nó (không lấy chung camp của term đầu tiên); trùng thì ghi 1 lần
        for kw in camp.get("keywords", []):
            term = str(kw.get("customerSearchTerm") or kw.get("keyword") or "").strip()
            camp_id = str(kw.get("sourceCampaignId") or camp.get("sourceCampaignId") or "").strip()
            if not term or not camp_id:
                continue
            camp_name = str(kw.get("sourceCampaignName") or camp.get("sourceCampaignName") or "").strip()
            ag_id = str(kw.get("sourceAdGroupId") or ("" if kw.get("sourceCampaignId") else camp.get("sourceAdGroupId")) or "").strip()
            ag_name = str(kw.get("sourceAdGroupName") or ("" if kw.get("sourceCampaignId") else camp.get("sourceAdGroupName")) or camp_name).strip()
            key = (camp_id, ag_id, term.lower())
            if key in seen_neg:
                continue
            seen_neg.add(key)
            negatives.append({
                "term": term, "campaignId": camp_id, "adGroupId": ag_id, "campaignName": camp_name, "adGroupName": ag_name,
                "adType": detect_ad_type(kw.get("sourceAdType") or ("" if kw.get("sourceCampaignId") else camp.get("sourceAdType")), camp_name),
            })

    for neg in negatives:
        write_source_negative(writers, neg)

    if output_path:
        wb.save(output_path)
    else:
        import io
        buf = io.BytesIO()
        wb.save(buf)
        sys.stdout.buffer.write(buf.getvalue())


if __name__ == "__main__":
    if len(sys.argv) > 2:
        input_json_path = sys.argv[1]
        output_xlsx_path = sys.argv[2]
        with open(input_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        export_sale_kw_bulksheet(data, output_xlsx_path)
    else:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw else {"campaigns": []}
        export_sale_kw_bulksheet(data)
