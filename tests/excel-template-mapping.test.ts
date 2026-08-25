import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const automationScript = join(process.cwd(), "scripts", "excel-automation.py");

test("maps template A values into shop B blank without copying shop A workbook metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "template-map-test-"));
  const source = join(directory, "shop-a.xlsx");
  const destination = join(directory, "shop-b.xlsx");
  const output = join(directory, "mapped-shop-b.xlsx");

  try {
    const fixtureScript = String.raw`
import sys
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation

headers = [
    "contribution_sku",
    "product_type",
    "parentage_level[marketplace_id=ATVPDKIKX0DER]",
    "child_parent_sku_relationship[marketplace_id=ATVPDKIKX0DER].parent_sku",
    "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]",
    "product_description[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]",
    "generic_keyword[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]",
    "main_product_image_locator",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US][#1.value]",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US][#2.value]",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US][#3.value]",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US][#4.value]",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US][#5.value]",
    "brand[marketplace_id=ATVPDKIKX0DER]",
]

source_path, destination_path = sys.argv[1:3]

source = Workbook()
sheet = source.active
sheet.title = "Template"
sheet["A1"] = "settings=attributeRow=3&labelRow=2&dataRow=4&contributorId=amzn1.cr.o.SHOPA12345&primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER&templateIdentifier=template-shop-a&ptds=T1JOQU1FTlQ="
for column, header in enumerate(headers, 1):
    sheet.cell(2, column).value = f"Label {column}"
    sheet.cell(3, column).value = header
parent = ["SAMPLE_MAIN", "ornament", "Parent", "", "Source title", "Source description", "source terms", "", "One", "Two", "Three", "Four", "Five", "Brand A"]
child = ["SAMPLE", "ornament", "Child", "SAMPLE_MAIN", "Child title", "Child description", "child terms", "https://shop-a.example/image.jpg", "One", "Two", "Three", "Four", "Five", "Brand A"]
for column, value in enumerate(parent, 1):
    sheet.cell(4, column).value = value
for column, value in enumerate(child, 1):
    sheet.cell(5, column).value = value
sheet["E4"].comment = Comment("Shop A private note", "Shop A")
source.create_sheet("Shop A Metadata").sheet_state = "hidden"
source.properties.title = "SHOP A SECRET"
source.save(source_path)

destination = Workbook()
sheet = destination.active
sheet.title = "Template"
sheet["A1"] = "settings=attributeRow=3&labelRow=2&dataRow=4&contributorId=amzn1.cr.o.SHOPB67890&primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER&templateIdentifier=template-shop-b&ptds=T1JOQU1FTlQ="
destination_headers = list(reversed(headers))
for column, header in enumerate(destination_headers, 1):
    sheet.cell(2, column).value = f"Destination label {column}"
    sheet.cell(3, column).value = header
validation = DataValidation(type="list", formula1='"Parent,Child"')
sheet.add_data_validation(validation)
validation.add("L4:L100")
destination.create_sheet("Shop B Metadata").sheet_state = "hidden"
destination.properties.title = "SHOP B TOKEN"
destination.save(destination_path)
`;
    execFileSync("python3", ["-c", fixtureScript, source, destination], { stdio: "pipe" });

    const scan = JSON.parse(execFileSync(
      "python3",
      [automationScript, "scan_template", destination],
      { encoding: "utf8" },
    ));
    assert.equal(scan.contributor_id, "amzn1.cr.o.SHOPB67890");
    assert.equal(scan.shop_key, "SHOPB67890");
    assert.equal(scan.marketplace_id, "ATVPDKIKX0DER");
    assert.equal(scan.template_identifier, "template-shop-b");
    assert.equal(scan.product_type, "ORNAMENT");
    assert.equal(scan.phoi_name, "Ornament");

    const report = JSON.parse(execFileSync(
      "python3",
      [automationScript, "map_template", source, destination, output, "--brand", "Brand B"],
      { encoding: "utf8" },
    ));
    assert.equal(report.mapped_values, report.source_values);
    assert.equal(report.unmapped_columns.length, 0);

    const inspectScript = String.raw`
import json
import sys
from openpyxl import load_workbook

workbook = load_workbook(sys.argv[1], data_only=False)
sheet = workbook["Template"]
columns = {sheet.cell(3, column).value: column for column in range(1, sheet.max_column + 1)}
sku_column = columns["contribution_sku"]
title_column = columns["item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]"]
brand_column = columns["brand[marketplace_id=ATVPDKIKX0DER]"]
print(json.dumps({
    "title": workbook.properties.title,
    "sheets": workbook.sheetnames,
    "parent_sku": sheet.cell(4, sku_column).value,
    "child_sku": sheet.cell(5, sku_column).value,
    "child_title": sheet.cell(5, title_column).value,
    "parent_brand": sheet.cell(4, brand_column).value,
    "child_brand": sheet.cell(5, brand_column).value,
    "source_comment_copied": sheet.cell(4, title_column).comment is not None,
    "validation_count": len(sheet.data_validations.dataValidation),
}))
`;
    const result = JSON.parse(execFileSync("python3", ["-c", inspectScript, output], { encoding: "utf8" }));
    assert.equal(result.title, "SHOP B TOKEN");
    assert.deepEqual(result.sheets, ["Template", "Shop B Metadata"]);
    assert.equal(result.parent_sku, "SAMPLE_MAIN");
    assert.equal(result.child_sku, "SAMPLE");
    assert.equal(result.child_title, "Child title");
    assert.equal(result.parent_brand, "Brand B");
    assert.equal(result.child_brand, "Brand B");
    assert.equal(result.source_comment_copied, false);
    assert.equal(result.validation_count, 1);

    const inspection = JSON.parse(execFileSync(
      "python3",
      [automationScript, "inspect", output],
      { encoding: "utf8" },
    ));
    assert.equal(inspection.product_type, "ornament");
    assert.equal(inspection.main_sku, "SAMPLE");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
