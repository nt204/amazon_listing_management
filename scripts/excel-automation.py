#!/usr/bin/env python3
"""Parse compact SKU workbooks and fill Amazon category templates."""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import unicodedata
from copy import copy
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qsl

from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import MergedCell
from openpyxl.utils import get_column_letter


MAX_IMPORT_ROWS = 100
MAX_IMAGES = 10
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


SKU_HEADERS = {
    "sku",
    "seller sku",
    "seller sku code",
    "ma sku",
    "sku code",
    "item sku",
}
MAIN_KEYWORD_HEADERS = {
    "main keyword",
    "primary keyword",
    "product name",
    "ten san pham",
    "ten san pham main keyword",
    "ten san pham primary keyword",
    "item name",
}
GENERIC_KEYWORD_HEADERS = {
    "generic keyword",
    "generic keywords",
    "generic search terms",
    "search terms",
    "genkey",
    "backend search terms",
}
IMAGE_HEADERS = {
    "link anh",
    "link anh trello",
    "anh trello",
    "trello",
    "trello link",
    "image",
    "images",
    "image link",
    "image links",
    "image url",
    "image urls",
    "main image url",
}


def header_kind(value: Any) -> str | None:
    text = normalize(value)
    if text in SKU_HEADERS:
        return "sku"
    if text in MAIN_KEYWORD_HEADERS:
        return "main_keyword"
    if text in GENERIC_KEYWORD_HEADERS:
        return "generic_keywords"
    if text in IMAGE_HEADERS or text.startswith("other image url"):
        return "image_urls"
    return None


def find_import_table(workbook: Any) -> tuple[Any, int, dict[str, list[int]]]:
    best: tuple[int, Any, int, dict[str, list[int]]] | None = None
    for worksheet in workbook.worksheets:
        for row_index in range(1, min(worksheet.max_row, 50) + 1):
            columns: dict[str, list[int]] = {}
            for column_index in range(1, min(worksheet.max_column, 400) + 1):
                kind = header_kind(worksheet.cell(row_index, column_index).value)
                if kind:
                    columns.setdefault(kind, []).append(column_index)
            required = sum(key in columns for key in ("sku", "main_keyword", "image_urls"))
            score = required * 10 + int("generic_keywords" in columns)
            if best is None or score > best[0]:
                best = (score, worksheet, row_index, columns)
            if required == 3 and "generic_keywords" in columns:
                return worksheet, row_index, columns
    if best and best[0] >= 30:
        return best[1], best[2], best[3]
    raise ValueError(
        "Không tìm thấy đủ cột SKU, Link ảnh (Trello) và Tên sản phẩm (Main Keyword)."
    )


def extract_urls(values: Iterable[tuple[Any, str | None]]) -> list[str]:
    urls: list[str] = []
    for value, hyperlink in values:
        candidates = []
        if hyperlink:
            candidates.append(hyperlink)
        candidates.extend(URL_PATTERN.findall(cell_text(value)))
        for candidate in candidates:
            url = candidate.rstrip(").,;]")
            if url not in urls:
                urls.append(url)
    return urls[:MAX_IMAGES]


def parse_workbook(source_path: Path) -> dict[str, Any]:
    workbook = load_workbook(
        source_path,
        read_only=False,
        data_only=True,
        keep_vba=source_path.suffix.lower() == ".xlsm",
    )
    worksheet, header_row, columns = find_import_table(workbook)
    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_skus: set[str] = set()

    settings = cell_text(worksheet.cell(1, 1).value)
    if "dataRow=" in settings:
        attribute_row, _, _ = configured_template_rows(worksheet)
        template_columns = technical_columns(worksheet, attribute_row)
        parent_row, child_row = source_template_rows(worksheet, template_columns)
        data_start_row = min(parent_row, child_row)
    else:
        data_start_row = header_row + 1
    for row_index in range(data_start_row, worksheet.max_row + 1):
        sku = cell_text(worksheet.cell(row_index, columns["sku"][0]).value)
        main_keyword = cell_text(worksheet.cell(row_index, columns["main_keyword"][0]).value)
        generic_keywords = " | ".join(
            filter(
                None,
                (
                    cell_text(worksheet.cell(row_index, column).value)
                    for column in columns.get("generic_keywords", [])
                ),
            )
        )
        image_cells = []
        for column in columns["image_urls"]:
            cell = worksheet.cell(row_index, column)
            hyperlink = cell.hyperlink.target if cell.hyperlink else None
            image_cells.append((cell.value, hyperlink))
        image_urls = extract_urls(image_cells)

        if not any((sku, main_keyword, generic_keywords, image_urls)):
            continue
        missing = []
        if not sku:
            missing.append("SKU")
        if not main_keyword:
            missing.append("Tên sản phẩm (Main Keyword)")
        if not image_urls:
            missing.append("Link ảnh")
        if missing:
            raise ValueError(f"Dòng {row_index} thiếu: {', '.join(missing)}.")
        if sku.upper().endswith("_MAIN"):
            continue
        sku_key = sku.casefold()
        if sku_key in seen_skus:
            raise ValueError(f"SKU bị trùng ở dòng {row_index}: {sku}.")
        seen_skus.add(sku_key)
        if not generic_keywords:
            warnings.append(f"Dòng {row_index} ({sku}) chưa có Generic Keywords.")

        rows.append(
            {
                "source_row": row_index,
                "sku": sku,
                "main_keyword": main_keyword,
                "generic_keywords": generic_keywords,
                "image_urls": image_urls,
            }
        )
        if len(rows) >= MAX_IMPORT_ROWS:
            warnings.append(f"Chỉ đọc {MAX_IMPORT_ROWS} SKU đầu tiên.")
            break

    if not rows:
        raise ValueError("File Excel không có SKU hợp lệ.")
    return {
        "sheet_name": worksheet.title,
        "header_row": header_row,
        "rows": rows,
        "warnings": warnings,
    }


def create_sample(output_path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "SKU Input"
    worksheet.append(
        [
            "SKU",
            "Link ảnh (Trello)",
            "Tên sản phẩm (Main Keyword)",
            "Generic Keywords",
        ]
    )
    sample_rows = [
        [
            "AOTT0731DL01C",
            "\n".join(
                [
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a74642c9a401d4b8bf125a6/download/AOTT0731DL01C_mk0.png",
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a746432c00e48ec9ec81805/download/AOTT0731DL01C_mk1.png",
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a746438c87599438c7d3d14/download/AOTT0731DL01C_mk2.png",
                ]
            ),
            "personalized golden retriever dog lover ornament",
            "golden retriever keepsake | dog owner christmas gift | personalized pet decor | holiday tree ornament",
        ],
        [
            "AOTT0731DL02C",
            "\n".join(
                [
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a74643d6f57586281295fc6/download/AOTT0731DL02C_mk0.png",
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a746443ff5d65eeccb059ac/download/AOTT0731DL02C_mk1.png",
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a7464498d3141c8a1de96b4/download/AOTT0731DL02C_mk2.png",
                ]
            ),
            "personalized labrador retriever dog lover ornament",
            "labrador retriever keepsake | dog owner christmas gift | personalized pet decor | holiday tree ornament",
        ],
        [
            "AOTT0731DL03C",
            "\n".join(
                [
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a74644f42f81be4c16a9069/download/AOTT0731DL03C_mk0.png",
                    "https://trello.com/1/cards/6a687525740c6bf7bc9fe6a5/attachments/6a7464545e3ec8a0e3fffb23/download/AOTT0731DL03C_mk1.png",
                ]
            ),
            "personalized french bulldog dog lover ornament",
            "french bulldog keepsake | dog owner christmas gift | personalized pet decor | holiday tree ornament",
        ],
    ]
    for sample_row in sample_rows:
        worksheet.append(sample_row)
    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = f"A1:D{len(sample_rows) + 1}"
    for cell in worksheet[1]:
        font = copy(cell.font)
        font.bold = True
        cell.font = font
    worksheet.column_dimensions["A"].width = 22
    worksheet.column_dimensions["B"].width = 70
    worksheet.column_dimensions["C"].width = 42
    worksheet.column_dimensions["D"].width = 55
    for row_index in range(2, len(sample_rows) + 2):
        worksheet.row_dimensions[row_index].height = 54
        image_alignment = copy(worksheet.cell(row_index, 2).alignment)
        image_alignment.wrap_text = True
        image_alignment.vertical = "top"
        worksheet.cell(row_index, 2).alignment = image_alignment
    workbook.save(output_path)


def snapshot_row(worksheet: Any, row_index: int) -> list[dict[str, Any]]:
    snapshot = []
    for column_index in range(1, worksheet.max_column + 1):
        cell = worksheet.cell(row_index, column_index)
        snapshot.append(
            {
                "value": cell.value,
                "style": copy(cell._style),
                "hyperlink": copy(cell.hyperlink),
                "comment": copy(cell.comment),
            }
        )
    return snapshot


def restore_row(worksheet: Any, row_index: int, snapshot: list[dict[str, Any]]) -> None:
    for column_index, source in enumerate(snapshot, start=1):
        cell = worksheet.cell(row_index, column_index)
        cell.value = source["value"]
        cell._style = copy(source["style"])
        cell.hyperlink = copy(source["hyperlink"])
        cell.comment = copy(source["comment"])


def setting_row(worksheet: Any, name: str) -> int | None:
    settings = cell_text(worksheet.cell(1, 1).value)
    if settings.startswith("settings="):
        settings = settings[len("settings="):]
    match = re.search(rf"(?:^|&){name}=(\d+)(?:&|$)", settings)
    return int(match.group(1)) if match else None


def discover_attribute_row(worksheet: Any) -> int:
    best: tuple[int, int] | None = None
    markers = (
        "contribution_sku",
        "product_type",
        "item_name[",
        "product_description[",
        "generic_keyword[",
        "main_product_image_locator",
    )
    for row_index in range(1, min(worksheet.max_row, 100) + 1):
        names = [cell_text(worksheet.cell(row_index, column).value) for column in range(1, worksheet.max_column + 1)]
        score = sum(any(name.startswith(marker) for name in names) for marker in markers)
        if best is None or score > best[0]:
            best = (score, row_index)
    if not best or best[0] < 3:
        raise ValueError("Không tìm thấy dòng technical headers trong template Amazon.")
    return best[1]


def discover_label_row(worksheet: Any, attribute_row: int) -> int:
    configured = setting_row(worksheet, "labelRow")
    if configured is not None:
        return configured
    candidates = []
    for row_index in range(1, attribute_row):
        populated = sum(
            bool(cell_text(worksheet.cell(row_index, column).value))
            for column in range(1, worksheet.max_column + 1)
        )
        candidates.append((populated, row_index))
    return max(candidates)[1] if candidates else attribute_row


def configured_template_rows(worksheet: Any) -> tuple[int, int, int | None]:
    attribute_row = setting_row(worksheet, "attributeRow") or discover_attribute_row(worksheet)
    return attribute_row, discover_label_row(worksheet, attribute_row), setting_row(worksheet, "dataRow")


def amazon_template_settings(worksheet: Any) -> dict[str, str]:
    raw = cell_text(worksheet.cell(1, 1).value)
    if raw.startswith("settings="):
        raw = raw[len("settings="):]
    return {key: value for key, value in parse_qsl(raw, keep_blank_values=True)}


def decode_base64_text(value: str) -> str:
    if not value:
        return ""
    try:
        padded = value + "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8").strip()
    except (ValueError, UnicodeDecodeError):
        return ""


def format_product_type(value: str) -> str:
    words = re.sub(r"[_-]+", " ", cell_text(value)).strip().split()
    return " ".join(word.upper() if len(word) <= 3 else word.capitalize() for word in words)


def is_example_or_dummy_row(sku: str, title: str = "", brand: str = "") -> bool:
    s = sku.strip().casefold()
    t = title.strip().casefold()
    b = brand.strip().casefold()
    combined = f"{s} {t} {b}"

    # Exact or regex match for common dummy/sample SKUs (e.g. ABC123, ABC-123, XYZ123, SAMPLE_SKU)
    if re.search(r"^(abc|xyz|sample|example|test|demo|dummy|sku|placeholder|temp|none|n/a)[\d_-]*$", s):
        return True

    dummy_patterns = [
        "example",
        "sample",
        "demo",
        "test_sku",
        "test sku",
        "dummy",
        "abc123",
        "xyz123",
        "sku123",
        "[required]",
        "[optional]",
        "e.g.",
        "eg.",
    ]
    for pat in dummy_patterns:
        if pat in s:
            return True
    if s.startswith("ex_") or s.startswith("sample_") or s.startswith("test_"):
        return True
    if any(p in combined for p in ["example product", "example sku", "sample brand", "sample product", "example parent", "example child", "abc123", "dummy"]):
        return True
    return False


def scan_listing_template(template_path: Path) -> dict[str, Any]:
    workbook = load_workbook(
        template_path,
        read_only=False,
        data_only=False,
        keep_vba=template_path.suffix.lower() == ".xlsm",
    )
    if "Template" not in workbook.sheetnames:
        raise ValueError("Workbook không có sheet Template.")
    worksheet = workbook["Template"]
    attribute_row, label_row, data_row = configured_template_rows(worksheet)
    columns = technical_columns(worksheet, attribute_row)
    settings = amazon_template_settings(worksheet)

    contributor_id = settings.get("contributorId", "").strip()
    marketplace_id = settings.get("primaryMarketplaceId", "").strip()
    product_types: list[str] = []
    decoded_ptds = decode_base64_text(settings.get("ptds", ""))
    if decoded_ptds:
        try:
            parsed_ptds = json.loads(decoded_ptds)
            candidates = parsed_ptds if isinstance(parsed_ptds, list) else [parsed_ptds]
            product_types.extend(cell_text(value) for value in candidates if cell_text(value))
        except json.JSONDecodeError:
            product_types.append(decoded_ptds)

    decoded_browse = decode_base64_text(settings.get("browseClassifications", ""))
    if decoded_browse:
        try:
            for entry in json.loads(decoded_browse):
                product_type = cell_text(entry.get("productType")) if isinstance(entry, dict) else ""
                if product_type:
                    product_types.append(product_type)
        except (json.JSONDecodeError, TypeError):
            pass

    product_type_column = optional_column(columns, "product_type")
    if product_type_column is not None:
        for row_index in range(attribute_row + 1, min(worksheet.max_row, attribute_row + 50) + 1):
            product_type = cell_text(worksheet.cell(row_index, product_type_column).value)
            if product_type:
                product_types.append(product_type)

    product_type = next((value for value in product_types if value), "")
    if not product_type:
        raise ValueError("Không nhận diện được loại phôi từ metadata Amazon trong file.")
    if not contributor_id:
        raise ValueError("Không nhận diện được shop vì file không có contributorId của Seller Central.")

    store_name = (
        settings.get("storeName")
        or settings.get("merchantName")
        or settings.get("sellerName")
        or settings.get("accountName")
        or settings.get("brandName")
        or settings.get("brand")
        or settings.get("merchant_name")
        or settings.get("store_name")
        or ""
    ).strip()

    sku_col = None
    for name, idx in columns.items():
        if name.startswith("contribution_sku") or name == "item_sku":
            sku_col = idx
            break

    if not store_name:
        for prefix in ("brand[", "brand_name", "merchant_name", "store_name", "manufacturer["):
            for row_index in range(attribute_row + 1, min(worksheet.max_row, attribute_row + 30) + 1):
                sku_val = cell_text(worksheet.cell(row_index, sku_col).value) if sku_col else ""
                if is_example_or_dummy_row(sku_val):
                    continue
                val = first_value_with_prefix(worksheet, row_index, columns, prefix)
                if val and val.casefold() not in ("generic", "na", "n/a", "unknown") and not is_example_or_dummy_row(sku_val, brand=val):
                    store_name = val
                    break
            if store_name:
                break

    if not store_name:
        stem = template_path.stem.strip()
        if " - " in stem:
            candidate = stem.split(" - ")[0].strip()
            if candidate and not candidate.lower().startswith("amazon") and not candidate.lower().startswith("flat"):
                store_name = candidate
        elif "_" in stem:
            candidate = stem.split("_")[0].strip()
            if candidate and not candidate.lower().startswith("amazon") and not candidate.lower().startswith("flat"):
                store_name = candidate

    return {
        "sheet_name": worksheet.title,
        "attribute_row": attribute_row,
        "label_row": label_row,
        "data_row": data_row,
        "column_count": worksheet.max_column,
        "contributor_id": contributor_id,
        "shop_key": contributor_id.rsplit(".", 1)[-1],
        "marketplace_id": marketplace_id.rsplit(".", 1)[-1],
        "template_identifier": settings.get("templateIdentifier", "").strip(),
        "store_name": store_name,
        "product_type": product_type,
        "phoi_name": format_product_type(product_type),
    }


def technical_columns(worksheet: Any, attribute_row: int | None = None) -> dict[str, int]:
    if attribute_row is None:
        attribute_row = configured_template_rows(worksheet)[0]
    result: dict[str, int] = {}
    for column_index in range(1, worksheet.max_column + 1):
        name = cell_text(worksheet.cell(attribute_row, column_index).value)
        if name:
            result[name] = column_index
    return result


def technical_header_signature(name: str) -> str:
    """Match the same Amazon field across nearby template revisions."""
    signature = cell_text(name).casefold()
    signature = re.sub(
        r"\[(marketplace_id|language_tag)=[^\]]+\]",
        lambda match: f"[{match.group(1)}=*]",
        signature,
    )
    return re.sub(r"\s+", "", signature)


def destination_column_for_source(
    source_name: str,
    destination_columns: dict[str, int],
    destination_signatures: dict[str, list[int]],
) -> int | None:
    if source_name in destination_columns:
        return destination_columns[source_name]
    candidates = destination_signatures.get(technical_header_signature(source_name), [])
    return candidates[0] if len(candidates) == 1 else None


def source_template_rows(worksheet: Any, columns: dict[str, int], data_row: int | None = None) -> tuple[int, int]:
    del data_row
    attribute_row = configured_template_rows(worksheet)[0]
    sku_column = find_column(columns, prefix="contribution_sku")
    parentage_column = find_column(columns, prefix="parentage_level[")
    relationship_column = find_column(columns, prefix="child_parent_sku_relationship[")

    title_col = None
    for name, idx in columns.items():
        if name.startswith("item_name[") or name == "item_name":
            title_col = idx
            break

    brand_col = None
    for name, idx in columns.items():
        if name.startswith("brand[") or name == "brand_name":
            brand_col = idx
            break

    parents: dict[str, list[int]] = {}
    children: list[tuple[int, str]] = []

    for row_index in range(attribute_row + 1, worksheet.max_row + 1):
        sku = cell_text(worksheet.cell(row_index, sku_column).value)
        parentage = cell_text(worksheet.cell(row_index, parentage_column).value).casefold()
        if not sku:
            continue
        if parentage == "parent" or sku.upper().endswith("_MAIN"):
            parents.setdefault(sku.casefold(), []).append(row_index)
        else:
            parent_sku = cell_text(worksheet.cell(row_index, relationship_column).value)
            children.append((row_index, parent_sku.casefold()))

    valid_pairs: list[tuple[int, int, bool]] = []
    for child_row, parent_sku in children:
        if parent_sku in parents:
            for parent_row in parents[parent_sku]:
                parent_sku_val = cell_text(worksheet.cell(parent_row, sku_column).value)
                child_sku_val = cell_text(worksheet.cell(child_row, sku_column).value)
                parent_title = cell_text(worksheet.cell(parent_row, title_col).value) if title_col else ""
                child_title = cell_text(worksheet.cell(child_row, title_col).value) if title_col else ""
                parent_brand = cell_text(worksheet.cell(parent_row, brand_col).value) if brand_col else ""

                is_p_dummy = is_example_or_dummy_row(parent_sku_val, parent_title, parent_brand)
                is_c_dummy = is_example_or_dummy_row(child_sku_val, child_title, parent_brand)
                is_real = not (is_p_dummy or is_c_dummy)

                valid_pairs.append((parent_row, child_row, is_real))

    # Priority 1: Real user product rows
    real_pairs = [p for p in valid_pairs if p[2]]
    if real_pairs:
        return real_pairs[0][0], real_pairs[0][1]

    # Priority 2: Fallback to any valid pair if no other rows exist
    if valid_pairs:
        return valid_pairs[0][0], valid_pairs[0][1]

    raise ValueError("Template cần có ít nhất một dòng mẫu Parent và một dòng mẫu Child.")


def values_with_prefix(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    prefix: str,
) -> list[str]:
    values = []
    for name, column_index in columns.items():
        if name.startswith(prefix):
            value = cell_text(worksheet.cell(row_index, column_index).value)
            if value and value not in values:
                values.append(value)
    return values


def first_value_with_prefix(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    prefix: str,
) -> str:
    values = values_with_prefix(worksheet, row_index, columns, prefix)
    return values[0] if values else ""


def dimension_text(worksheet: Any, row_index: int, columns: dict[str, int]) -> str:
    dimensions = []
    unit = ""
    for axis in ("width", "height", "depth"):
        value = ""
        for name, column_index in columns.items():
            if "item_depth_width_height" in name and f".{axis}.value" in name:
                value = cell_text(worksheet.cell(row_index, column_index).value)
            if "item_depth_width_height" in name and f".{axis}.unit" in name:
                unit = unit or cell_text(worksheet.cell(row_index, column_index).value)
        if value:
            dimensions.append(value)
    if not dimensions:
        return ""
    return f"{' x '.join(dimensions)} {unit}".strip()


def inspect_template(template_path: Path) -> dict[str, Any]:
    workbook = load_workbook(
        template_path,
        read_only=False,
        data_only=False,
        keep_vba=template_path.suffix.lower() == ".xlsm",
    )
    if "Template" not in workbook.sheetnames:
        raise ValueError("Workbook không có sheet Template.")
    worksheet = workbook["Template"]
    attribute_row, label_row, data_row = configured_template_rows(worksheet)
    columns = technical_columns(worksheet, attribute_row)
    required_prefixes = [
        "contribution_sku",
        "product_type",
        "parentage_level[",
        "child_parent_sku_relationship[",
        "item_name[",
        "product_description[",
        "generic_keyword[",
        "main_product_image_locator",
    ]
    for prefix in required_prefixes:
        find_column(columns, prefix=prefix)
    bullet_columns = []
    for occurrence in range(1, 6):
        marker = f"#{occurrence}."
        matching = [index for name, index in columns.items() if name.startswith("bullet_point[") and marker in name]
        if not matching:
            raise ValueError(f"Template thiếu Bullet Point #{occurrence}.")
        bullet_columns.append(get_column_letter(matching[0]))
    parent_row, child_row = source_template_rows(worksheet, columns, data_row)
    parent_sku = cell_text(worksheet.cell(parent_row, find_column(columns, prefix="contribution_sku")).value)
    child_sku = cell_text(worksheet.cell(child_row, find_column(columns, prefix="contribution_sku")).value)
    main_sku = (child_sku or parent_sku).replace("_MAIN", "").strip()
    color = first_value_with_prefix(worksheet, child_row, columns, "color[")
    if color.casefold() == child_sku.casefold():
        color = ""
    return {
        "main_sku": main_sku,
        "sheet_name": worksheet.title,
        "attribute_row": attribute_row,
        "label_row": label_row,
        "data_row": min(parent_row, child_row),
        "column_count": worksheet.max_column,
        "last_column": get_column_letter(worksheet.max_column),
        "source_parent_row": parent_row,
        "source_child_row": child_row,
        "product_type": first_value_with_prefix(worksheet, child_row, columns, "product_type"),
        "content_columns": {
            "sku": get_column_letter(find_column(columns, prefix="contribution_sku")),
            "title": get_column_letter(find_column(columns, prefix="item_name[")),
            "description": get_column_letter(find_column(columns, prefix="product_description[")),
            "bullet_points": bullet_columns,
            "generic_keywords": get_column_letter(find_column(columns, prefix="generic_keyword[")),
            "main_image": get_column_letter(find_column(columns, prefix="main_product_image_locator")),
        },
        "defaults": {
            "material": ", ".join(values_with_prefix(worksheet, child_row, columns, "material[")),
            "size_capacity": dimension_text(worksheet, child_row, columns),
            "color": color,
            "package_contents": ", ".join(values_with_prefix(worksheet, child_row, columns, "included_components[")),
            "features": values_with_prefix(worksheet, child_row, columns, "special_feature["),
            "country_of_origin": first_value_with_prefix(worksheet, child_row, columns, "country_of_origin["),
        },
    }


def extract_valid_options_for_column(
    workbook: Any,
    worksheet: Any,
    column_index: int,
    column_name: str,
) -> list[str]:
    options: list[str] = []
    try:
        if hasattr(worksheet, "data_validations") and worksheet.data_validations:
            for dv in worksheet.data_validations.dataValidation:
                in_range = False
                for r in dv.ranges:
                    if r.min_col <= column_index <= r.max_col:
                        in_range = True
                        break
                if in_range and dv.formula1:
                    formula_str = str(dv.formula1).strip().lstrip("=")
                    if formula_str.startswith('"') and formula_str.endswith('"'):
                        items = [x.strip() for x in formula_str[1:-1].split(",") if x.strip()]
                        if items:
                            return items
                    elif "!" in formula_str:
                        try:
                            sheet_ref, range_ref = formula_str.split("!", 1)
                            sheet_name = sheet_ref.strip("'\"").strip()
                            range_clean = range_ref.replace("$", "").strip()
                            if sheet_name in workbook.sheetnames:
                                ref_sheet = workbook[sheet_name]
                                cells = ref_sheet[range_clean]
                                if not isinstance(cells, tuple):
                                    cells = ((cells,),)
                                elif len(cells) > 0 and not isinstance(cells[0], tuple):
                                    cells = (cells,)
                                for row in cells:
                                    for cell in row:
                                        val = cell_text(cell.value).strip()
                                        if val and val not in options:
                                            options.append(val)
                                if options:
                                    return options
                        except Exception:
                            pass
                    elif hasattr(workbook, "defined_names") and formula_str in workbook.defined_names:
                        try:
                            defn = workbook.defined_names[formula_str]
                            for title, coord in defn.destinations:
                                if title in workbook.sheetnames:
                                    ref_sheet = workbook[title]
                                    range_clean = coord.replace("$", "").strip()
                                    cells = ref_sheet[range_clean]
                                    if not isinstance(cells, tuple):
                                        cells = ((cells,),)
                                    elif len(cells) > 0 and not isinstance(cells[0], tuple):
                                        cells = (cells,)
                                    for row in cells:
                                        for cell in row:
                                            val = cell_text(cell.value).strip()
                                            if val and val not in options:
                                                options.append(val)
                                    if options:
                                        return options
                        except Exception:
                            pass
    except Exception:
        pass

    for sheet_candidate in ["Valid Values", "ValidValues", "Data Definitions"]:
        if sheet_candidate in workbook.sheetnames:
            try:
                vv_sheet = workbook[sheet_candidate]
                target_col = None
                for row_idx in range(1, min(6, vv_sheet.max_row + 1)):
                    for col_idx in range(1, vv_sheet.max_column + 1):
                        header_val = cell_text(vv_sheet.cell(row_idx, col_idx).value).casefold()
                        if (
                            "merchant_shipping_group_name" in header_val
                            or ("shipping" in header_val and ("template" in header_val or "group" in header_val or "merchant" in header_val))
                            or column_name.casefold() in header_val
                        ):
                            target_col = col_idx
                            break
                    if target_col:
                        break

                if target_col:
                    for r in range(2, vv_sheet.max_row + 1):
                        val = cell_text(vv_sheet.cell(r, target_col).value).strip()
                        if val and val not in options and not val.startswith("=") and not val.casefold().startswith("example"):
                            options.append(val)
                    if options:
                        return options
            except Exception:
                pass

    return options


def validate_shipping_for_row(workbook: Any, worksheet: Any, row_index: int, columns: dict[str, int]) -> None:
    shipping_col = optional_column(columns, "merchant_shipping_group_name")
    if shipping_col is None:
        for name, col_idx in columns.items():
            if "shipping" in name.lower() and ("merchant" in name.lower() or "group" in name.lower() or "template" in name.lower()):
                shipping_col = col_idx
                break
    if shipping_col is not None:
        current_val = cell_text(worksheet.cell(row_index, shipping_col).value).strip()
        options = extract_valid_options_for_column(workbook, worksheet, shipping_col, "merchant_shipping_group_name")
        if options:
            matched = next((opt for opt in options if opt.casefold() == current_val.casefold()), None)
            if matched:
                worksheet.cell(row_index, shipping_col).value = matched
            else:
                worksheet.cell(row_index, shipping_col).value = options[0]


def map_template_to_blank(
    source_path: Path,
    destination_path: Path,
    output_path: Path,
    target_brand: str = "",
) -> dict[str, Any]:
    """Copy row values by Amazon technical header while retaining destination workbook metadata."""
    source_workbook = load_workbook(
        source_path,
        read_only=False,
        data_only=False,
        keep_vba=source_path.suffix.lower() == ".xlsm",
    )
    destination_workbook = load_workbook(
        destination_path,
        read_only=False,
        data_only=False,
        keep_vba=destination_path.suffix.lower() == ".xlsm",
    )
    if "Template" not in source_workbook.sheetnames:
        raise ValueError("Template nguồn không có sheet Template.")
    if "Template" not in destination_workbook.sheetnames:
        raise ValueError("Blank template của shop đích không có sheet Template.")

    source_sheet = source_workbook["Template"]
    destination_sheet = destination_workbook["Template"]
    source_attribute_row, _, source_data_row = configured_template_rows(source_sheet)
    destination_attribute_row, _, destination_data_row = configured_template_rows(destination_sheet)
    source_columns = technical_columns(source_sheet, source_attribute_row)
    destination_columns = technical_columns(destination_sheet, destination_attribute_row)
    source_parent_row, source_child_row = source_template_rows(
        source_sheet,
        source_columns,
        source_data_row,
    )
    source_rows = [source_parent_row]
    if source_child_row != source_parent_row:
        source_rows.append(source_child_row)

    destination_signatures: dict[str, list[int]] = {}
    for name, column_index in destination_columns.items():
        destination_signatures.setdefault(technical_header_signature(name), []).append(column_index)

    target_start_row = destination_data_row or destination_attribute_row + 1
    if target_start_row <= destination_attribute_row:
        raise ValueError("Dòng bắt đầu dữ liệu của blank template shop đích không hợp lệ.")

    mapped_headers: set[str] = set()
    unmapped_headers: set[str] = set()
    source_value_count = 0
    mapped_value_count = 0
    for row_offset, source_row_index in enumerate(source_rows):
        destination_row_index = target_start_row + row_offset
        for source_name, source_column_index in source_columns.items():
            source_cell = source_sheet.cell(source_row_index, source_column_index)
            if source_cell.value is None and source_cell.hyperlink is None:
                continue
            if isinstance(source_cell.value, str) and source_cell.value.startswith("="):
                # Formulas can contain workbook links or references. Mapping copies plain content only.
                continue
            source_value_count += 1
            destination_column_index = destination_column_for_source(
                source_name,
                destination_columns,
                destination_signatures,
            )
            if destination_column_index is None:
                unmapped_headers.add(source_name)
                continue

            val_to_set = source_cell.value
            if "shipping" in source_name.lower():
                options = extract_valid_options_for_column(
                    destination_workbook,
                    destination_sheet,
                    destination_column_index,
                    source_name,
                )
                if options:
                    matched = next(
                        (opt for opt in options if opt.casefold() == str(val_to_set).strip().casefold()),
                        None,
                    )
                    if matched:
                        val_to_set = matched
                    else:
                        val_to_set = options[0]

            destination_cell = destination_sheet.cell(destination_row_index, destination_column_index)
            destination_cell.value = val_to_set
            destination_cell.hyperlink = source_cell.hyperlink.target if source_cell.hyperlink else None
            mapped_headers.add(source_name)
            mapped_value_count += 1

    if not mapped_value_count:
        raise ValueError("Không tìm thấy cột tương thích giữa template nguồn và blank template shop đích.")

    if target_brand:
        for row_offset in range(len(source_rows)):
            destination_row_index = target_start_row + row_offset
            set_optional_value(
                destination_sheet,
                destination_row_index,
                destination_columns,
                target_brand,
                prefix="brand[",
            )
            set_optional_value(
                destination_sheet,
                destination_row_index,
                destination_columns,
                target_brand,
                prefix="manufacturer[",
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    destination_workbook.save(output_path)
    return {
        "source_columns": len(source_columns),
        "destination_columns": len(destination_columns),
        "mapped_columns": len(mapped_headers),
        "source_values": source_value_count,
        "mapped_values": mapped_value_count,
        "unmapped_columns": sorted(unmapped_headers)[:50],
    }


def find_column(columns: dict[str, int], exact: str | None = None, prefix: str | None = None) -> int:
    if exact and exact in columns:
        return columns[exact]
    if prefix:
        for name, index in columns.items():
            if name.startswith(prefix):
                return index
    raise ValueError(f"Template thiếu cột bắt buộc: {exact or prefix}")


def optional_column(columns: dict[str, int], prefix: str) -> int | None:
    for name, index in columns.items():
        if name.startswith(prefix):
            return index
    return None


def set_optional_value(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    value: Any,
    prefix: str,
) -> None:
    column_index = optional_column(columns, prefix)
    if column_index is not None:
        worksheet.cell(row_index, column_index).value = value


def set_image_locator_value(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    value: str,
    prefix: str,
    required: bool = False,
) -> None:
    column_index = (
        find_column(columns, prefix=prefix)
        if required
        else optional_column(columns, prefix)
    )
    if column_index is None:
        return
    cell = worksheet.cell(row_index, column_index)
    cell.value = value
    cell.hyperlink = value or None


def set_value(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    value: Any,
    exact: str | None = None,
    prefix: str | None = None,
) -> None:
    worksheet.cell(row_index, find_column(columns, exact=exact, prefix=prefix)).value = value


def set_repeated_value(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    prefix: str,
    occurrence: int,
    value: Any,
) -> None:
    marker = f"#{occurrence}."
    for name, column_index in columns.items():
        if name.startswith(prefix) and marker in name:
            worksheet.cell(row_index, column_index).value = value
            return
    raise ValueError(f"Template thiếu cột bắt buộc: {prefix} #{occurrence}")


def listing_text(item: dict[str, Any], key: str, fallback: Any = "") -> Any:
    return item.get("listing", {}).get(key, fallback)


def find_image_column(columns: dict[str, int], image_type: str, index: int = 1) -> int | None:
    if image_type == "main":
        patterns = ["main_product_image_locator", "main_image_url", "main_image"]
        for p in patterns:
            for name, col_idx in columns.items():
                if name.startswith(p):
                    return col_idx
        return None
    elif image_type == "swatch":
        patterns = ["swatch_product_image_locator", "swatch_image_url"]
        for p in patterns:
            for name, col_idx in columns.items():
                if name.startswith(p):
                    return col_idx
        return None
    elif image_type == "other":
        patterns = [
            f"other_product_image_locator_{index}",
            f"other_product_image_locator[#{index}.",
            f"other_product_image_locator{index}",
            f"other_image_url{index}",
            f"other_image_url_{index}",
            f"other_image_locator_{index}",
        ]
        for p in patterns:
            for name, col_idx in columns.items():
                if name.startswith(p):
                    return col_idx
        return None
    return None


def fill_listing_fields(
    worksheet: Any,
    row_index: int,
    columns: dict[str, int],
    item: dict[str, Any],
) -> None:
    set_value(worksheet, row_index, columns, listing_text(item, "title"), prefix="item_name")
    set_value(
        worksheet,
        row_index,
        columns,
        listing_text(item, "description"),
        prefix="product_description",
    )
    bullets = list(listing_text(item, "bullet_points", []))[:5]
    bullets.extend([""] * (5 - len(bullets)))
    for bullet_index, bullet in enumerate(bullets, start=1):
        set_repeated_value(
            worksheet,
            row_index,
            columns,
            "bullet_point[",
            bullet_index,
            bullet,
        )
    set_value(
        worksheet,
        row_index,
        columns,
        listing_text(item, "backend_search_terms"),
        prefix="generic_keyword",
    )

    main_col = find_image_column(columns, "main")
    if main_col:
        worksheet.cell(row_index, main_col).value = ""
        worksheet.cell(row_index, main_col).hyperlink = None

    swatch_col = find_image_column(columns, "swatch")
    if swatch_col:
        worksheet.cell(row_index, swatch_col).value = ""
        worksheet.cell(row_index, swatch_col).hyperlink = None

    for i in range(1, 9):
        other_col = find_image_column(columns, "other", i)
        if other_col:
            worksheet.cell(row_index, other_col).value = ""
            worksheet.cell(row_index, other_col).hyperlink = None

    image_urls = list(item.get("image_urls", []))[:7]
    if image_urls and main_col:
        worksheet.cell(row_index, main_col).value = image_urls[0]
        worksheet.cell(row_index, main_col).hyperlink = image_urls[0] or None

    for image_index, image_url in enumerate(image_urls[1:7], start=1):
        other_col = find_image_column(columns, "other", image_index)
        if other_col and image_url:
            worksheet.cell(row_index, other_col).value = image_url
            worksheet.cell(row_index, other_col).hyperlink = image_url or None


def replace_source_identifier(value: Any, source_sku: str, target_sku: str) -> Any:
    text = cell_text(value)
    if not text:
        return value
    if source_sku and source_sku in text:
        return text.replace(source_sku, target_sku)
    source_suffix = source_sku[-4:] if len(source_sku) >= 4 else source_sku
    target_suffix = target_sku[-4:] if len(target_sku) >= 4 else target_sku
    if source_suffix and text.endswith(source_suffix):
        return f"{text[:-len(source_suffix)]}{target_suffix}"
    return value


def sanitize_restored_row(
    worksheet: Any,
    row_index: int,
    source_skus: list[str],
    target_sku: str,
) -> None:
    for col_index in range(1, worksheet.max_column + 1):
        cell = worksheet.cell(row_index, col_index)
        text = cell_text(cell.value)
        if text:
            for s_sku in source_skus:
                if s_sku and s_sku in text:
                    text = text.replace(s_sku, target_sku)
            if "ABC123" in text:
                text = text.replace("ABC123", target_sku)
            cell.value = text


def clean_sku(raw: Any) -> str:
    s = cell_text(raw).strip()
    if not s:
        return "SKU"
    if "_" in s:
        parts = s.split("_")
        if len(parts) > 1 and " " in parts[1]:
            return parts[0].strip()
    elif " - " in s:
        return s.split(" - ")[0].strip()
    return s


def fill_template(template_path: Path, payload_path: Path, output_path: Path) -> None:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    items = payload.get("items", [])
    if not items:
        raise ValueError("Không có listing thành công để xuất template.")
    keep_vba = template_path.suffix.lower() == ".xlsm"
    workbook = load_workbook(template_path, keep_vba=keep_vba, data_only=False)
    worksheet = workbook["Template"] if "Template" in workbook.sheetnames else workbook.active
    attribute_row, _, data_row = configured_template_rows(worksheet)
    columns = technical_columns(worksheet, attribute_row)
    source_parent_row, source_child_row = source_template_rows(worksheet, columns, data_row)
    parent_snapshot = snapshot_row(worksheet, source_parent_row)
    child_snapshot = snapshot_row(worksheet, source_child_row)
    parent_height = worksheet.row_dimensions[source_parent_row].height
    child_height = worksheet.row_dimensions[source_child_row].height
    sku_column = find_column(columns, prefix="contribution_sku")
    source_parent_sku = cell_text(worksheet.cell(source_parent_row, sku_column).value)
    source_child_sku = cell_text(worksheet.cell(source_child_row, sku_column).value)
    model_column = optional_column(columns, "model_number")
    part_column = optional_column(columns, "part_number")
    color_column = optional_column(columns, "color[")
    source_parent_model = worksheet.cell(source_parent_row, model_column).value if model_column else None
    source_child_model = worksheet.cell(source_child_row, model_column).value if model_column else None
    source_parent_part = worksheet.cell(source_parent_row, part_column).value if part_column else None
    source_child_part = worksheet.cell(source_child_row, part_column).value if part_column else None
    source_parent_color = worksheet.cell(source_parent_row, color_column).value if color_column else None
    source_child_color = worksheet.cell(source_child_row, color_column).value if color_column else None

    target_data_row = data_row or min(source_parent_row, source_child_row)
    if target_data_row <= attribute_row:
        raise ValueError("Dòng bắt đầu dữ liệu của template Amazon không hợp lệ.")
    for row_index in range(attribute_row + 1, worksheet.max_row + 1):
        for column_index in range(1, worksheet.max_column + 1):
            cell = worksheet.cell(row_index, column_index)
            if not isinstance(cell, MergedCell):
                cell.value = None
                cell.hyperlink = None
                cell.comment = None

    parentage_col = optional_column(columns, "parentage_level[")
    has_parent_structure = source_parent_row != source_child_row and parentage_col is not None

    if has_parent_structure:
        first_sku = clean_sku(items[0].get("sku"))
        parent_sku = f"{first_sku}_MAIN"
        parent_brand = cell_text(items[0].get("brand")) or "Generic"
        parent_row = target_data_row
        restore_row(worksheet, parent_row, parent_snapshot)
        sanitize_restored_row(worksheet, parent_row, [source_parent_sku, source_child_sku], parent_sku)
        worksheet.row_dimensions[parent_row].height = parent_height
        set_value(worksheet, parent_row, columns, parent_sku, prefix="contribution_sku")
        set_value(worksheet, parent_row, columns, "Parent", prefix="parentage_level[")
        set_value(worksheet, parent_row, columns, "", prefix="child_parent_sku_relationship[")
        set_optional_value(worksheet, parent_row, columns, parent_brand, prefix="brand[")
        set_optional_value(worksheet, parent_row, columns, parent_brand, prefix="manufacturer[")
        set_optional_value(worksheet, parent_row, columns, replace_source_identifier(source_parent_model, source_parent_sku, parent_sku), prefix="model_number")
        set_optional_value(worksheet, parent_row, columns, replace_source_identifier(source_parent_part, source_parent_sku, parent_sku), prefix="part_number")
        parent_color = first_sku if cell_text(source_parent_color).casefold() in {source_child_sku.casefold(), source_parent_sku.casefold()} else source_parent_color
        set_optional_value(worksheet, parent_row, columns, parent_color, prefix="color[")
        validate_shipping_for_row(workbook, worksheet, parent_row, columns)
        fill_listing_fields(worksheet, parent_row, columns, items[0])

        for offset, item in enumerate(items, start=1):
            row_index = target_data_row + offset
            sku = clean_sku(item.get("sku"))
            brand = cell_text(item.get("brand")) or parent_brand
            restore_row(worksheet, row_index, child_snapshot)
            sanitize_restored_row(worksheet, row_index, [source_parent_sku, source_child_sku], sku)
            worksheet.row_dimensions[row_index].height = child_height
            set_value(worksheet, row_index, columns, sku, prefix="contribution_sku")
            set_value(worksheet, row_index, columns, "Child", prefix="parentage_level[")
            set_value(worksheet, row_index, columns, parent_sku, prefix="child_parent_sku_relationship[")
            set_optional_value(worksheet, row_index, columns, brand, prefix="brand[")
            set_optional_value(worksheet, row_index, columns, brand, prefix="manufacturer[")
            set_optional_value(worksheet, row_index, columns, replace_source_identifier(source_child_model, source_child_sku, sku), prefix="model_number")
            set_optional_value(worksheet, row_index, columns, replace_source_identifier(source_child_part, source_child_sku, sku), prefix="part_number")
            child_color = sku if cell_text(source_child_color).casefold() == source_child_sku.casefold() else source_child_color
            set_optional_value(worksheet, row_index, columns, child_color, prefix="color[")
            validate_shipping_for_row(workbook, worksheet, row_index, columns)
            fill_listing_fields(worksheet, row_index, columns, item)
    else:
        for offset, item in enumerate(items):
            row_index = target_data_row + offset
            sku = clean_sku(item.get("sku"))
            brand = cell_text(item.get("brand")) or "Generic"
            restore_row(worksheet, row_index, child_snapshot)
            sanitize_restored_row(worksheet, row_index, [source_parent_sku, source_child_sku], sku)
            worksheet.row_dimensions[row_index].height = child_height
            set_value(worksheet, row_index, columns, sku, prefix="contribution_sku")
            set_optional_value(worksheet, row_index, columns, brand, prefix="brand[")
            set_optional_value(worksheet, row_index, columns, brand, prefix="manufacturer[")
            set_optional_value(worksheet, row_index, columns, replace_source_identifier(source_child_model, source_child_sku, sku), prefix="model_number")
            set_optional_value(worksheet, row_index, columns, replace_source_identifier(source_child_part, source_child_sku, sku), prefix="part_number")
            child_color = sku if cell_text(source_child_color).casefold() == source_child_sku.casefold() else source_child_color
            set_optional_value(worksheet, row_index, columns, child_color, prefix="color[")
            validate_shipping_for_row(workbook, worksheet, row_index, columns)
            fill_listing_fields(worksheet, row_index, columns, item)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)


def create_standard_listing_excel(payload_path: Path, output_path: Path) -> None:
    data = json.loads(payload_path.read_text(encoding="utf-8"))
    items = data.get("items", [])

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Amazon Listings"

    headers = [
        "seller-sku",
        "marketplace",
        "product-type",
        "item-name",
        "brand-name",
        "bullet-point1",
        "bullet-point2",
        "bullet-point3",
        "bullet-point4",
        "bullet-point5",
        "product-description",
        "generic-keywords",
        "main-image-url",
        "other-image-url1",
        "other-image-url2",
        "other-image-url3",
        "other-image-url4",
        "other-image-url5",
        "other-image-url6",
    ]
    worksheet.append(headers)

    for item in items:
        sku = item.get("sku", "")
        listing = item.get("listing", {})
        brand = item.get("brand", "")
        image_urls = list(item.get("image_urls", []))[:7]

        bullets = listing.get("bullet_points", [])
        while len(bullets) < 5:
            bullets.append("")

        row = [
            sku,
            "US",
            "Listing Desk",
            listing.get("title", ""),
            brand,
            bullets[0],
            bullets[1],
            bullets[2],
            bullets[3],
            bullets[4],
            listing.get("description", ""),
            listing.get("backend_search_terms", ""),
            image_urls[0] if len(image_urls) > 0 else "",
            image_urls[1] if len(image_urls) > 1 else "",
            image_urls[2] if len(image_urls) > 2 else "",
            image_urls[3] if len(image_urls) > 3 else "",
            image_urls[4] if len(image_urls) > 4 else "",
            image_urls[5] if len(image_urls) > 5 else "",
            image_urls[6] if len(image_urls) > 6 else "",
        ]
        worksheet.append(row)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)

def resize_image_for_ai(input_path: Path, output_path: Path, max_dim: int = 1600, quality: int = 82) -> dict[str, Any]:
    from PIL import Image, ImageOps
    with Image.open(input_path) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        width, height = img.size
        if max(width, height) > max_dim:
            if width >= height:
                new_w = max_dim
                new_h = int(height * (max_dim / width))
            else:
                new_h = max_dim
                new_w = int(width * (max_dim / height))
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, format="JPEG", quality=quality, optimize=True)
    return {"status": "ok", "bytes": output_path.stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    parse_parser = subparsers.add_parser("parse")
    parse_parser.add_argument("source")

    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("source")

    scan_parser = subparsers.add_parser("scan_template")
    scan_parser.add_argument("source")

    sample_parser = subparsers.add_parser("sample")
    sample_parser.add_argument("output")

    fill_parser = subparsers.add_parser("fill")
    fill_parser.add_argument("template")
    fill_parser.add_argument("payload")
    fill_parser.add_argument("output")

    map_template_parser = subparsers.add_parser("map_template")
    map_template_parser.add_argument("source")
    map_template_parser.add_argument("destination")
    map_template_parser.add_argument("output")
    map_template_parser.add_argument("--brand", default="")

    build_excel_parser = subparsers.add_parser("build_excel")
    build_excel_parser.add_argument("payload")
    build_excel_parser.add_argument("output")

    resize_parser = subparsers.add_parser("resize_image")
    resize_parser.add_argument("source")
    resize_parser.add_argument("output")
    resize_parser.add_argument("--max-dim", type=int, default=1600)
    resize_parser.add_argument("--quality", type=int, default=82)

    args = parser.parse_args()
    if args.command == "parse":
        print(json.dumps(parse_workbook(Path(args.source)), ensure_ascii=False))
    elif args.command == "inspect":
        print(json.dumps(inspect_template(Path(args.source)), ensure_ascii=False))
    elif args.command == "scan_template":
        print(json.dumps(scan_listing_template(Path(args.source)), ensure_ascii=False))
    elif args.command == "sample":
        create_sample(Path(args.output))
    elif args.command == "fill":
        fill_template(Path(args.template), Path(args.payload), Path(args.output))
    elif args.command == "map_template":
        print(json.dumps(map_template_to_blank(
            Path(args.source),
            Path(args.destination),
            Path(args.output),
            args.brand,
        ), ensure_ascii=False))
    elif args.command == "build_excel":
        create_standard_listing_excel(Path(args.payload), Path(args.output))
    elif args.command == "resize_image":
        print(json.dumps(resize_image_for_ai(Path(args.source), Path(args.output), args.max_dim, args.quality), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        raise
