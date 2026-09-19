#!/usr/bin/env python3
"""High-performance streaming parser for Amazon Bulk Operations workbooks.
Uses zipfile + xml.parsers.expat for ultra-fast C-level streaming without loading
huge XML files into memory. Falls back to openpyxl if zipfile structure is non-standard.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
import xml.parsers.expat
import zipfile


def text(value):
    return "" if value is None else str(value).strip()


def identifier(value):
    result = text(value)
    match = re.fullmatch(r'="(.*)"', result)
    if match:
        return match.group(1)
    if result.endswith(".0") and result[:-2].isdigit():
        return result[:-2]
    return result


def number(value):
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[$,%()\s]", "", text(value))
    try:
        parsed = float(cleaned)
        return -parsed if text(value).startswith("(") else parsed
    except ValueError:
        return 0.0


def match_type(value):
    upper = text(value).upper()
    if "EXACT" in upper:
        return "Exact"
    if "PHRASE" in upper:
        return "Phrase"
    if "BROAD" in upper:
        return "Broad"
    if "AUTO" in upper:
        return "Auto"
    if "TARGET" in upper:
        return "Targeting"
    return "Unknown"


def grain(entity):
    value = entity.lower()
    if value == "campaign":
        return "CAMPAIGN"
    if value in ("ad group", "adgroup"):
        return "AD_GROUP"
    if "bidding adjustment" in value or "placement" in value:
        return "PLACEMENT"
    if value in ("product ad", "ad") or "product ad" in value:
        return "PRODUCT"
    if (
        value in ("keyword", "product targeting", "target", "auto targeting")
        or "negative keyword" in value
        or "negative product targeting" in value
    ):
        return "TARGET"
    return None


def ad_type(product, sheet_name, hint):
    value = f"{text(product)} {sheet_name}".lower()
    if "sponsored products" in value or "sp campaigns" in value:
        return "SP"
    if "sponsored brands" in value or "sb campaigns" in value or "hsa campaigns" in value:
        return "SB"
    if "sponsored display" in value or "sd campaigns" in value:
        return "SD"
    if hint and hint != "UNKNOWN":
        return hint
    return "SP"


def col_letter_to_index(col_str):
    idx = 0
    for char in col_str:
        idx = idx * 26 + (ord(char.upper()) - ord("A") + 1)
    return idx - 1


def parse_col_letter(cell_ref):
    m = re.match(r"^([A-Za-z]+)", cell_ref)
    return col_letter_to_index(m.group(1)) if m else -1


class FastSheetParser:
    def __init__(self, shared_strings, store, snapshot, start, end, granularity, hint, sheet_title, seen):
        self.shared_strings = shared_strings
        self.store = store
        self.snapshot = snapshot
        self.start = start
        self.end = end
        self.granularity = granularity

        # Infer sheet-level ad type from sheet title if available
        sheet_hint = hint
        sheet_lower = sheet_title.lower()
        if "sponsored products" in sheet_lower or "sp campaigns" in sheet_lower:
            sheet_hint = "SP"
        elif "sponsored brands" in sheet_lower or "sb campaigns" in sheet_lower or "hsa campaigns" in sheet_lower:
            sheet_hint = "SB"
        elif "sponsored display" in sheet_lower or "sd campaigns" in sheet_lower:
            sheet_hint = "SD"
        elif sheet_hint == "UNKNOWN":
            sheet_hint = "SP"

        self.hint = sheet_hint
        self.sheet_title = sheet_title
        self.seen = seen

        self.header_map = {}
        self.headers_found = False
        self.current_col = -1
        self.current_type = None
        self.current_text = []
        self.row_cells = {}
        self.flush_counter = 0

    def start_element(self, name, attrs):
        if name == "c":
            self.current_col = parse_col_letter(attrs.get("r", ""))
            self.current_type = attrs.get("t")
            self.current_text = []

    def end_element(self, name):
        if name == "c" and self.current_col >= 0:
            val = "".join(self.current_text).strip()
            if self.current_type == "s" and val.isdigit():
                idx = int(val)
                val = self.shared_strings[idx] if idx < len(self.shared_strings) else val
            self.row_cells[self.current_col] = val
            self.current_col = -1
        elif name == "row":
            self.process_row()
            self.row_cells.clear()

    def char_data(self, data):
        if self.current_col >= 0:
            self.current_text.append(data)

    def get(self, *col_names):
        for name in col_names:
            idx = self.header_map.get(name.lower())
            if idx is not None and idx in self.row_cells:
                return self.row_cells[idx]
        return ""

    def process_row(self):
        if not self.headers_found:
            normalized = {text(v).lower(): col for col, v in self.row_cells.items() if v}
            if "entity" in normalized and "campaign id" in normalized:
                self.header_map = normalized
                self.headers_found = True
            return

        entity = text(self.get("Entity"))
        row_grain = grain(entity)
        if not row_grain:
            return

        impressions = round(number(self.get("Impressions")))
        clicks = round(number(self.get("Clicks")))
        spend = round(number(self.get("Spend", "Cost", "Total cost")), 2)
        sales = round(number(self.get("Sales", "14 Day Total Sales", "14-day Total Sales")), 2)
        orders = round(number(self.get("Orders", "14 Day Total Orders", "14-day Total Orders")))
        units = round(number(self.get("Units", "14 Day Total Units", "14-day Total Units")))

        is_neg = "negative" in entity.lower()
        # Skip zero-metric negative targets to keep facts compact, lean and fast
        if is_neg and row_grain == "TARGET" and spend == 0 and clicks == 0 and impressions == 0:
            return

        campaign_id = identifier(self.get("Campaign ID"))
        ad_group_id = identifier(self.get("Ad Group ID"))
        keyword_id = identifier(self.get("Keyword ID"))
        product_target_id = identifier(self.get("Product Targeting ID", "Targeting ID", "Target ID"))
        ad_id = identifier(self.get("Ad ID", "Product Ad ID"))
        placement = text(self.get("Placement", "Bidding Adjustment Placement"))
        expression = text(self.get(
            "Keyword Text",
            "Product Targeting Expression",
            "Targeting Expression",
            "Resolved Product Targeting Expression (Informational only)",
        ))

        entity_id = {
            "CAMPAIGN": campaign_id,
            "AD_GROUP": ad_group_id,
            "TARGET": keyword_id or product_target_id,
            "PRODUCT": ad_id,
            "PLACEMENT": f"{campaign_id}:{placement}",
        }.get(row_grain, "")

        if not entity_id and not campaign_id:
            return

        row_ad_type = ad_type(self.get("Product"), self.sheet_title, self.hint)
        sku = text(self.get("SKU", "Retailer Offer ID"))

        result = {
            "storeName": self.store,
            "snapshotDate": self.snapshot,
            "reportStartDate": self.start,
            "reportEndDate": self.end,
            "reportGranularity": self.granularity,
            "adType": row_ad_type,
            "grain": row_grain,
            "entityId": entity_id or f"{row_grain}:{campaign_id}:{ad_group_id}:{expression}:{placement}",
            "campaignId": campaign_id,
            "campaignName": text(self.get("Campaign Name (Informational only)", "Campaign Name")),
            "adGroupId": ad_group_id,
            "adGroupName": text(self.get("Ad Group Name (Informational only)", "Ad Group Name")),
            "targetId": keyword_id or product_target_id,
            "targetExpression": expression,
            "matchType": match_type(self.get("Match Type", "Keyword Match Type", "Auto Match Type")),
            "portfolioName": text(self.get("Portfolio Name (Informational only)", "Portfolio Name")),
            "sku": sku,
            "asin": text(self.get("ASIN (Informational only)", "ASIN")),
            "state": text(self.get("State")),
            "campaignState": text(self.get("Campaign State (Informational only)")),
            "adGroupState": text(self.get("Ad Group State (Informational only)")),
            "targetingType": text(self.get("Targeting Type", "Target Type")),
            "biddingStrategy": text(self.get("Bidding Strategy", "Bid Optimization")),
            "placement": placement,
            "dailyBudget": number(self.get("Daily Budget", "Budget")),
            "bid": number(self.get("Bid", "Ad Group Default Bid")),
            "placementAdjustment": number(self.get("Percentage", "Bid Multiplier", "Bidding Adjustment Percentage")),
            "isNegative": is_neg,
            "impressions": impressions,
            "clicks": clicks,
            "spend": spend,
            "sales": sales,
            "orders": orders,
            "units": units,
        }

        key = (row_ad_type, row_grain, result["entityId"], sku, placement)
        if key in self.seen:
            return
        self.seen.add(key)

        sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n")
        self.flush_counter += 1
        if self.flush_counter % 200 == 0:
            sys.stdout.flush()


def parse_with_fast_expat(path, store, snapshot, start, end, granularity, hint):
    with zipfile.ZipFile(path) as z:
        # 1. Read shared strings
        shared_strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            with z.open("xl/sharedStrings.xml") as sf:
                s_tree = ET.parse(sf)
                for si in s_tree.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                    t_elem = si.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                    if t_elem is not None and t_elem.text:
                        shared_strings.append(t_elem.text)
                    else:
                        texts = [t.text for t in si.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t") if t.text]
                        shared_strings.append("".join(texts))

        # 2. Map sheet titles to XML files
        sheet_map = {}
        with z.open("xl/workbook.xml") as wf:
            w_tree = ET.parse(wf)
            rel_map = {}
            with z.open("xl/_rels/workbook.xml.rels") as rf:
                r_tree = ET.parse(rf)
                for rel in r_tree.findall(".//{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
                    rel_map[rel.attrib.get("Id")] = rel.attrib.get("Target")
            for s in w_tree.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet"):
                name = s.attrib.get("name")
                rid = s.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                target = rel_map.get(rid, "")
                if not target.startswith("xl/"):
                    target = "xl/" + target.lstrip("/")
                sheet_map[name] = target

        seen = set()
        for sheet_title, target_xml in sheet_map.items():
            # Skip readme or summary sheets
            if target_xml not in z.namelist():
                continue
            parser = FastSheetParser(shared_strings, store, snapshot, start, end, granularity, hint, sheet_title, seen)
            p = xml.parsers.expat.ParserCreate()
            p.StartElementHandler = parser.start_element
            p.EndElementHandler = parser.end_element
            p.CharacterDataHandler = parser.char_data

            with z.open(target_xml) as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    p.Parse(chunk)
            sys.stdout.flush()


def parse_with_openpyxl(path, store, snapshot, start, end, granularity, hint):
    import openpyxl
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    seen = set()
    for worksheet in workbook.worksheets:
        worksheet.reset_dimensions()
        rows = worksheet.iter_rows(values_only=True)
        header = None
        for _ in range(20):
            candidate = next(rows, None)
            if candidate is None:
                break
            normalized = [text(value).lower() for value in candidate]
            if "entity" in normalized and "campaign id" in normalized:
                header = {text(value).lower(): index for index, value in enumerate(candidate) if text(value)}
                break
        if not header:
            continue

        def get(row, *names):
            for name in names:
                index = header.get(name.lower())
                if index is not None and index < len(row):
                    return row[index]
            return None

        for row in rows:
            entity = text(get(row, "Entity"))
            row_grain = grain(entity)
            if not row_grain:
                continue

            impressions = round(number(get(row, "Impressions")))
            clicks = round(number(get(row, "Clicks")))
            spend = round(number(get(row, "Spend", "Cost", "Total cost")), 2)
            sales = round(number(get(row, "Sales", "14 Day Total Sales", "14-day Total Sales")), 2)
            orders = round(number(get(row, "Orders", "14 Day Total Orders", "14-day Total Orders")))
            units = round(number(get(row, "Units", "14 Day Total Units", "14-day Total Units")))

            is_neg = "negative" in entity.lower()
            if is_neg and row_grain == "TARGET" and spend == 0 and clicks == 0 and impressions == 0:
                continue

            campaign_id = identifier(get(row, "Campaign ID"))
            ad_group_id = identifier(get(row, "Ad Group ID"))
            keyword_id = identifier(get(row, "Keyword ID"))
            product_target_id = identifier(get(row, "Product Targeting ID", "Targeting ID", "Target ID"))
            ad_id = identifier(get(row, "Ad ID", "Product Ad ID"))
            placement = text(get(row, "Placement", "Bidding Adjustment Placement"))
            expression = text(get(row, "Keyword Text", "Product Targeting Expression", "Targeting Expression", "Resolved Product Targeting Expression (Informational only)"))
            entity_id = {
                "CAMPAIGN": campaign_id,
                "AD_GROUP": ad_group_id,
                "TARGET": keyword_id or product_target_id,
                "PRODUCT": ad_id,
                "PLACEMENT": f"{campaign_id}:{placement}",
            }[row_grain]
            if not entity_id and not campaign_id:
                continue
            result = {
                "storeName": store,
                "snapshotDate": snapshot,
                "reportStartDate": start,
                "reportEndDate": end,
                "reportGranularity": granularity,
                "adType": ad_type(get(row, "Product"), worksheet.title, hint),
                "grain": row_grain,
                "entityId": entity_id or f"{row_grain}:{campaign_id}:{ad_group_id}:{expression}:{placement}",
                "campaignId": campaign_id,
                "campaignName": text(get(row, "Campaign Name (Informational only)", "Campaign Name")),
                "adGroupId": ad_group_id,
                "adGroupName": text(get(row, "Ad Group Name (Informational only)", "Ad Group Name")),
                "targetId": keyword_id or product_target_id,
                "targetExpression": expression,
                "matchType": match_type(get(row, "Match Type", "Keyword Match Type", "Auto Match Type")),
                "portfolioName": text(get(row, "Portfolio Name (Informational only)", "Portfolio Name")),
                "sku": text(get(row, "SKU", "Retailer Offer ID")),
                "asin": text(get(row, "ASIN (Informational only)", "ASIN")),
                "state": text(get(row, "State")),
                "campaignState": text(get(row, "Campaign State (Informational only)")),
                "adGroupState": text(get(row, "Ad Group State (Informational only)")),
                "targetingType": text(get(row, "Targeting Type", "Target Type")),
                "biddingStrategy": text(get(row, "Bidding Strategy", "Bid Optimization")),
                "placement": placement,
                "dailyBudget": number(get(row, "Daily Budget", "Budget")),
                "bid": number(get(row, "Bid", "Ad Group Default Bid")),
                "placementAdjustment": number(get(row, "Percentage", "Bid Multiplier", "Bidding Adjustment Percentage")),
                "isNegative": is_neg,
                "impressions": impressions,
                "clicks": clicks,
                "spend": spend,
                "sales": sales,
                "orders": orders,
                "units": units,
            }
            key = (result["adType"], row_grain, result["entityId"], result["sku"], placement)
            if key in seen:
                continue
            seen.add(key)
            sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n")
    workbook.close()


def main():
    if len(sys.argv) != 8:
        raise ValueError("Expected workbook, store, snapshot, start, end, granularity and ad type.")
    path, store, snapshot, start, end, granularity, hint = sys.argv[1:]
    try:
        parse_with_fast_expat(path, store, snapshot, start, end, granularity, hint)
    except Exception as e:
        # Fallback to openpyxl if zipfile parsing encounters an unexpected format
        sys.stderr.write(f"Fast expat parser error ({e}), falling back to openpyxl...\n")
        parse_with_openpyxl(path, store, snapshot, start, end, granularity, hint)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(str(error) + "\n")
        sys.exit(1)
