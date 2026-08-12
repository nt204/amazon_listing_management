#!/usr/bin/env python3
"""Parse compact SKU workbooks and fill Amazon category templates."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from copy import copy
from pathlib import Path
from typing import Any, Iterable

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
        names = [cell_text(worksheet.cell(row_index, column)) for column in range(1, worksheet.max_column + 1)]
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


def technical_columns(worksheet: Any, attribute_row: int | None = None) -> dict[str, int]:
    if attribute_row is None:
        attribute_row = configured_template_rows(worksheet)[0]
    result: dict[str, int] = {}
    for column_index in range(1, worksheet.max_column + 1):
        name = cell_text(worksheet.cell(attribute_row, column_index).value)
        if name:
            result[name] = column_index
    return result


def source_template_rows(worksheet: Any, columns: dict[str, int], data_row: int | None = None) -> tuple[int, int]:
    del data_row
    attribute_row = configured_template_rows(worksheet)[0]
    sku_column = find_column(columns, prefix="contribution_sku")
    parentage_column = find_column(columns, prefix="parentage_level[")
    relationship_column = find_column(columns, prefix="child_parent_sku_relationship[")
    parents: dict[str, int] = {}
    children: list[tuple[int, str]] = []
    for row_index in range(attribute_row + 1, worksheet.max_row + 1):
        sku = cell_text(worksheet.cell(row_index, sku_column).value)
        parentage = cell_text(worksheet.cell(row_index, parentage_column).value).casefold()
        if not sku:
            continue
        if parentage == "parent" or sku.upper().endswith("_MAIN"):
            parents.setdefault(sku.casefold(), row_index)
        else:
            parent_sku = cell_text(worksheet.cell(row_index, relationship_column).value)
            children.append((row_index, parent_sku.casefold()))
    for child_row, parent_sku in children:
        if parent_sku in parents:
            return parents[parent_sku], child_row
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

    set_image_locator_value(
        worksheet,
        row_index,
        columns,
        "",
        prefix="main_product_image_locator",
        required=True,
    )
    set_image_locator_value(
        worksheet,
        row_index,
        columns,
        "",
        prefix="swatch_product_image_locator",
    )
    for image_index in range(1, 9):
        set_image_locator_value(
            worksheet,
            row_index,
            columns,
            "",
            prefix=f"other_product_image_locator_{image_index}",
        )
    image_urls = list(item.get("image_urls", []))[:9]
    if image_urls:
        set_image_locator_value(
            worksheet,
            row_index,
            columns,
            image_urls[0],
            prefix="main_product_image_locator",
            required=True,
        )
        set_image_locator_value(
            worksheet,
            row_index,
            columns,
            image_urls[0],
            prefix="swatch_product_image_locator",
        )
    for image_index, image_url in enumerate(image_urls[1:9], start=1):
        set_image_locator_value(
            worksheet,
            row_index,
            columns,
            image_url,
            prefix=f"other_product_image_locator_{image_index}",
        )


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
        first_sku = cell_text(items[0].get("sku"))
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
        fill_listing_fields(worksheet, parent_row, columns, items[0])

        for offset, item in enumerate(items, start=1):
            row_index = target_data_row + offset
            sku = cell_text(item.get("sku"))
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
            fill_listing_fields(worksheet, row_index, columns, item)
    else:
        for offset, item in enumerate(items):
            row_index = target_data_row + offset
            sku = cell_text(item.get("sku"))
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
    ]
    worksheet.append(headers)

    for item in items:
        sku = item.get("sku", "")
        listing = item.get("listing", {})
        brand = item.get("brand", "")
        image_urls = item.get("image_urls", [])

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
        ]
        worksheet.append(row)

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

    sample_parser = subparsers.add_parser("sample")
    sample_parser.add_argument("output")

    fill_parser = subparsers.add_parser("fill")
    fill_parser.add_argument("template")
    fill_parser.add_argument("payload")
    fill_parser.add_argument("output")

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
    elif args.command == "sample":
        create_sample(Path(args.output))
    elif args.command == "fill":
        fill_template(Path(args.template), Path(args.payload), Path(args.output))
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
