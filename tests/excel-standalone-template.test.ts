import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const automationScript = join(process.cwd(), "scripts", "excel-automation.py");

test("scans red required cells and exports standalone listings without variation rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "standalone-template-test-"));
  const blank = join(directory, "blank.xlsx");
  const prepared = join(directory, "prepared.xlsx");
  const payload = join(directory, "fields.json");
  const listingPayload = join(directory, "listing.json");
  const output = join(directory, "listing.xlsx");

  try {
    const fixtureScript = String.raw`
import sys
from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Border, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

headers = [
    "contribution_sku#1.value",
    "product_type#1.value",
    "::record_action",
    "parentage_level[marketplace_id=ATVPDKIKX0DER]#1.value",
    "child_parent_sku_relationship[marketplace_id=ATVPDKIKX0DER]#1.parent_sku",
    "variation_theme#1.name",
    "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
    "product_description[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
    "generic_keyword[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
    "main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#2.value",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#3.value",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#4.value",
    "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#5.value",
    "brand[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
    "merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value",
    "wrong_product_type_field[marketplace_id=ATVPDKIKX0DER]#1.value",
    "gray_field[marketplace_id=ATVPDKIKX0DER]#1.value",
    "conditional_gray_field[marketplace_id=ATVPDKIKX0DER]#1.value",
    "preserved_default_field[marketplace_id=ATVPDKIKX0DER]#1.value",
]

workbook = Workbook()
sheet = workbook.active
sheet.title = "Template"
sheet["A1"] = "settings=attributeRow=3&labelRow=2&dataRow=4&contributorId=amzn1.cr.o.SHOP123&primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER&templateIdentifier=standalone-test&ptds=T1JOQU1FTlQ="
for column, header in enumerate(headers, 1):
    sheet.cell(2, column).value = "Shipping Template" if column == 17 else f"Label {column}"
    sheet.cell(3, column).value = header

options = workbook.create_sheet("Dropdown Lists")
options["A1"] = "Standard"
options["A2"] = "Expedited"
workbook.defined_names.add(DefinedName("shipping_options", attr_text="'Dropdown Lists'!$A$1:$A$2"))
validation = DataValidation(type="list", formula1="shipping_options")
sheet.add_data_validation(validation)
validation.add("Q4:Q1048576")
red = Side(style="thin", color="FFFF0000")
gray = Side(style="thin", color="FFD4D4D4")
white = PatternFill(fill_type="solid", fgColor="FFFFFFFF")
workbook.defined_names.add(DefinedName("PTList0", attr_text='Template!$B1="ORNAMENT"'))
workbook.defined_names.add(DefinedName("PTList1", attr_text='Template!$B1="SHIRT"'))
workbook.defined_names.add(DefinedName("reqPTList0shipping", attr_text='AND(NOT(LEN(Template!$Q1)>0),Template!$B1<>"")'))
workbook.defined_names.add(DefinedName("reqPTList1wrongtype", attr_text='AND(NOT(LEN(Template!$R1)>0),Template!$B1<>"")'))
sheet.conditional_formatting.add(
    "Q4:Q1048576",
    FormulaRule(formula=["IF(PTList0,reqPTList0shipping,0)"], fill=white, border=Border(left=red, right=red, top=red, bottom=red)),
)

# A red rule for another product type is gray/non-applicable in Excel.
sheet.conditional_formatting.add(
    "R4:R1048576",
    FormulaRule(formula=["IF(PTList1,reqPTList1wrongtype,0)"], fill=white, border=Border(left=red, right=red, top=red, bottom=red)),
)

# A gray cell is never an input field, even if its base style retained a red border.
sheet["S4"].fill = PatternFill(fill_type="solid", fgColor="FF999999")
sheet["S4"].border = Border(left=red, right=red, top=red, bottom=red)
sheet["U4"] = "Keep me"

# Excel stops on this higher-priority gray rule, so the red rule behind it is
# not the rendered style and must not be scanned.
sheet["T4"].fill = white
sheet["T4"].border = Border(left=red, right=red, top=red, bottom=red)
sheet.conditional_formatting.add(
    "T4:T1048576",
    FormulaRule(formula=["TRUE"], fill=white, border=Border(left=gray, right=gray, top=gray, bottom=gray), stopIfTrue=True),
)
sheet.conditional_formatting.add(
    "T4:T1048576",
    FormulaRule(formula=["IF(reqPTList0blocked,1,0)"], fill=white, border=Border(left=red, right=red, top=red, bottom=red), stopIfTrue=True),
)

# A populated cell with the same required/red rule is green in Excel and must
# not be requested again. A reqPTList formula without red styling is not a red
# required cell either.
sheet["P4"] = "Already configured"
sheet.conditional_formatting.add(
    "P4:P1048576",
    FormulaRule(formula=["IF(reqPTList0configured,1,0)"], fill=white, border=Border(left=red, right=red, top=red, bottom=red)),
)
sheet.conditional_formatting.add(
    "U4:U1048576",
    FormulaRule(formula=["IF(reqPTList0notred,1,0)"], fill=PatternFill(fill_type="solid", fgColor="FFFFFFFF")),
)
workbook.save(sys.argv[1])
`;
    execFileSync("python3", ["-c", fixtureScript, blank], { stdio: "pipe" });

    const scan = JSON.parse(execFileSync(
      "python3",
      [automationScript, "scan_required_fields", blank],
      { encoding: "utf8" },
    ));
    assert.equal(scan.required_fields.length, 1);
    assert.equal(scan.required_fields[0].label, "Shipping Template");
    assert.deepEqual(scan.required_fields[0].options, ["Standard", "Expedited"]);

    writeFileSync(payload, JSON.stringify({
      brand_name: "Standalone Brand",
      field_values: { [scan.required_fields[0].id]: "Expedited" },
    }));
    const inspection = JSON.parse(execFileSync(
      "python3",
      [automationScript, "prepare_standalone", blank, payload, prepared],
      { encoding: "utf8" },
    ));
    assert.equal(inspection.listing_mode, "standalone");
    assert.equal(inspection.source_parent_row, 4);
    assert.equal(inspection.source_child_row, 4);

    writeFileSync(listingPayload, JSON.stringify({ items: [{
      sku: "SKU-001",
      brand: "Standalone Brand",
      image_urls: ["https://example.com/main.jpg"],
      listing: {
        title: "Independent product",
        description: "Independent description",
        bullet_points: ["One", "Two", "Three", "Four", "Five"],
        backend_search_terms: "independent product",
      },
    }] }));
    execFileSync("python3", [automationScript, "fill", prepared, listingPayload, output]);

    const inspectOutputScript = String.raw`
import json
import sys
from openpyxl import load_workbook

workbook = load_workbook(sys.argv[1], data_only=False)
sheet = workbook["Template"]
columns = {sheet.cell(3, column).value: column for column in range(1, sheet.max_column + 1)}
print(json.dumps({
    "sku": sheet.cell(4, columns["contribution_sku#1.value"]).value,
    "next_sku": sheet.cell(5, columns["contribution_sku#1.value"]).value,
    "parentage": sheet.cell(4, columns["parentage_level[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "parent_sku": sheet.cell(4, columns["child_parent_sku_relationship[marketplace_id=ATVPDKIKX0DER]#1.parent_sku"]).value,
    "variation": sheet.cell(4, columns["variation_theme#1.name"]).value,
    "shipping": sheet.cell(4, columns["merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "preserved_default": sheet.cell(4, columns["preserved_default_field[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
}))
`;
    const result = JSON.parse(execFileSync("python3", ["-c", inspectOutputScript, output], { encoding: "utf8" }));
    assert.equal(result.sku, "SKU-001");
    assert.equal(result.next_sku, null);
    assert.equal(result.parentage, null);
    assert.equal(result.parent_sku, null);
    assert.equal(result.variation, null);
    assert.equal(result.shipping, "Expedited");
    assert.equal(result.preserved_default, "Keep me");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the first upload always shows seven setup attributes with existing values", () => {
  const directory = mkdtempSync(join(tmpdir(), "standalone-attributes-test-"));
  const blank = join(directory, "blank.xlsx");
  const prepared = join(directory, "prepared.xlsx");
  const payload = join(directory, "fields.json");

  try {
    const fixtureScript = String.raw`
import sys
from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Border, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

headers = [
    ("contribution_sku#1.value", "SKU"),
    ("product_type#1.value", "Product Type"),
    ("item_name[marketplace_id=ATVPDKIKX0DER]#1.value", "Title"),
    ("product_description[marketplace_id=ATVPDKIKX0DER]#1.value", "Description"),
    ("generic_keyword[marketplace_id=ATVPDKIKX0DER]#1.value", "Generic Keywords"),
    ("bullet_point[marketplace_id=ATVPDKIKX0DER]#1.value", "Bullet 1"),
    ("bullet_point[marketplace_id=ATVPDKIKX0DER]#2.value", "Bullet 2"),
    ("bullet_point[marketplace_id=ATVPDKIKX0DER]#3.value", "Bullet 3"),
    ("bullet_point[marketplace_id=ATVPDKIKX0DER]#4.value", "Bullet 4"),
    ("bullet_point[marketplace_id=ATVPDKIKX0DER]#5.value", "Bullet 5"),
    ("main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location", "Main Image"),
    ("material[marketplace_id=ATVPDKIKX0DER]#1.value", "Material"),
    ("color[marketplace_id=ATVPDKIKX0DER]#1.value", "Color"),
    ("fabric_type[marketplace_id=ATVPDKIKX0DER]#1.value", "Fabric Type"),
    ("item_shape[marketplace_id=ATVPDKIKX0DER]#1.value", "Item Shape"),
    ("item_package_length[marketplace_id=ATVPDKIKX0DER]#1.value", "Package Length"),
    ("item_package_width[marketplace_id=ATVPDKIKX0DER]#1.value", "Package Width"),
    ("item_package_height[marketplace_id=ATVPDKIKX0DER]#1.value", "Package Height"),
    ("item_package_length_unit_of_measure#1.value", "Package Dimension Unit"),
    ("merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value", "Shipping Template"),
    ("model_number#1.value", "Model Name"),
    ("part_number#1.value", "Part Number"),
    ("item_display_depth#1.value", "Item Display Depth"),
    ("item_display_diameter#1.value", "Item Display Diameter"),
    ("item_display_height#1.value", "Item Display Height"),
    ("item_display_length#1.value", "Item Display Length"),
    ("item_display_width#1.value", "Item Display Width"),
    ("unit_count_type#1.value", "Unit Count Type"),
]

workbook = Workbook()
sheet = workbook.active
sheet.title = "Template"
sheet["A1"] = "settings=attributeRow=3&labelRow=2&dataRow=4&contributorId=amzn1.cr.o.SHOP123&primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER&templateIdentifier=standalone-test&ptds=T1JOQU1FTlQ="

for column, (header, label) in enumerate(headers, 1):
    sheet.cell(2, column).value = label
    sheet.cell(3, column).value = header

# A first upload may already contain values. They must still be shown so the
# operator can confirm or edit them.
for coordinate, value in {
    "L4": "Ceramic",
    "M4": "Blue",
    "N4": "Cotton",
    "O4": "Round",
    "P4": "3",
    "Q4": "3",
    "R4": "0.25",
}.items():
    sheet[coordinate] = value

options = workbook.create_sheet("Dropdown Lists")
options["A1"] = "Standard"
options["A2"] = "Expedited"
options["B1"] = "Ceramic"
options["B2"] = "Wood"
options["B3"] = "PVC"
options["C1"] = "inches"
options["C2"] = "cm"

workbook.defined_names.add(DefinedName("shipping_options", attr_text="'Dropdown Lists'!$A$1:$A$2"))
workbook.defined_names.add(DefinedName("material_options", attr_text="'Dropdown Lists'!$B$1:$B$3"))
workbook.defined_names.add(DefinedName("unit_options", attr_text="'Dropdown Lists'!$C$1:$C$2"))

val_shipping = DataValidation(type="list", formula1="shipping_options")
sheet.add_data_validation(val_shipping)
val_shipping.add("T4:T1048576")

val_mat = DataValidation(type="list", formula1="material_options")
sheet.add_data_validation(val_mat)
val_mat.add("L4:L1048576")

val_unit = DataValidation(type="list", formula1="unit_options")
sheet.add_data_validation(val_unit)
val_unit.add("S4:S1048576")

red = Side(style="thin", color="FFFF0000")
white = PatternFill(fill_type="solid", fgColor="FFFFFFFF")
workbook.defined_names.add(DefinedName("PTList0", attr_text='Template!$B1="ORNAMENT"'))
workbook.defined_names.add(DefinedName("reqPTList0shipping", attr_text='AND(NOT(LEN(Template!$T1)>0),Template!$B1<>"")'))

sheet.conditional_formatting.add(
    "T4:T1048576",
    FormulaRule(formula=["IF(PTList0,reqPTList0shipping,0)"], fill=white, border=Border(left=red, right=red, top=red, bottom=red)),
)

workbook.save(sys.argv[1])
`;
    execFileSync("python3", ["-c", fixtureScript, blank], { stdio: "pipe" });

    writeFileSync(payload, JSON.stringify({
      include_setup_fields: true,
      show_existing_setup_fields: true,
      field_values: {},
    }));

    const scan = JSON.parse(execFileSync(
      "python3",
      [automationScript, "scan_required_fields", blank, payload],
      { encoding: "utf8" },
    ));

    assert.deepEqual(scan.required_fields.map((field: any) => field.label), [
      "Material",
      "Color",
      "Fabric Type",
      "Item Shape",
      "Package Length (inches)",
      "Package Width (inches)",
      "Package Height (inches)",
      "Shipping Template",
    ]);
    assert.deepEqual(scan.required_fields.slice(0, 7).map((field: any) => field.default_value), [
      "Ceramic",
      "Blue",
      "Cotton",
      "Round",
      "3",
      "3",
      "0.25",
    ]);
    assert.ok(!scan.required_fields.some((field: any) => [
      "Model Name",
      "Part Number",
      "Item Display Depth",
      "Item Display Diameter",
      "Item Display Height",
      "Item Display Length",
      "Item Display Width",
      "Unit Count Type",
    ].includes(field.label)));

    const fieldValues: Record<string, string> = {
      [scan.required_fields[0].id]: "PVC",
      [scan.required_fields[1].id]: "Red",
      [scan.required_fields[2].id]: "Polyester",
      [scan.required_fields[3].id]: "Round",
      [scan.required_fields[4].id]: "4",
      [scan.required_fields[5].id]: "4",
      [scan.required_fields[6].id]: "0.5",
      [scan.required_fields[7].id]: "Standard",
    };

    writeFileSync(payload, JSON.stringify({
      brand_name: "My Brand",
      field_values: fieldValues,
      include_setup_fields: true,
      show_existing_setup_fields: false,
    }));

    execFileSync(
      "python3",
      [automationScript, "prepare_standalone", blank, payload, prepared],
      { encoding: "utf8" },
    );

    const inspectPreparedScript = String.raw`
import json
import sys
from openpyxl import load_workbook

workbook = load_workbook(sys.argv[1], data_only=False)
sheet = workbook["Template"]
columns = {sheet.cell(3, column).value: column for column in range(1, sheet.max_column + 1)}
print(json.dumps({
    "material": sheet.cell(4, columns["material[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "color": sheet.cell(4, columns["color[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "fabric": sheet.cell(4, columns["fabric_type[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "shape": sheet.cell(4, columns["item_shape[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "length": sheet.cell(4, columns["item_package_length[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "width": sheet.cell(4, columns["item_package_width[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "height": sheet.cell(4, columns["item_package_height[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
    "unit": sheet.cell(4, columns["item_package_length_unit_of_measure#1.value"]).value,
    "shipping": sheet.cell(4, columns["merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value"]).value,
}))
`;
    const res = JSON.parse(execFileSync("python3", ["-c", inspectPreparedScript, prepared], { encoding: "utf8" }));
    assert.equal(res.material, "PVC");
    assert.equal(res.color, "Red");
    assert.equal(res.fabric, "Polyester");
    assert.equal(res.shape, "Round");
    assert.equal(res.length, "4");
    assert.equal(res.width, "4");
    assert.equal(res.height, "0.5");
    assert.equal(res.unit, null);
    assert.equal(res.shipping, "Standard");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reactive scan preserves existing fields and unlocks newly triggered dependent red cells", () => {
  const directory = mkdtempSync(join(tmpdir(), "standalone-reactive-test-"));
  try {
    const blank = join(directory, "blank.xlsx");
    const fieldsPayload = join(directory, "fields.json");

    const fixtureScript = String.raw`
import sys
from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Border, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

headers = [
    ("contribution_sku#1.value", "SKU"),
    ("product_type#1.value", "Product Type"),
    ("item_name[marketplace_id=ATVPDKIKX0DER]#1.value", "Title"),
    ("product_description[marketplace_id=ATVPDKIKX0DER]#1.value", "Description"),
    ("generic_keyword[marketplace_id=ATVPDKIKX0DER]#1.value", "Generic Keywords"),
    ("bullet_point[marketplace_id=ATVPDKIKX0DER]#1.value", "Bullet 1"),
    ("material[marketplace_id=ATVPDKIKX0DER]#1.value", "Material"),
    ("package_contains[marketplace_id=ATVPDKIKX0DER]#1.value", "Package Contains"),
    ("special_feature[marketplace_id=ATVPDKIKX0DER]#1.value", "Special Feature"),
]

workbook = Workbook()
sheet = workbook.active
sheet.title = "Template"
sheet["A1"] = "settings=attributeRow=3&labelRow=2&dataRow=4&contributorId=amzn1.cr.o.SHOP123&primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER&templateIdentifier=standalone-test&ptds=T1JOQU1FTlQ="

for column, (header, label) in enumerate(headers, 1):
    sheet.cell(2, column).value = label
    sheet.cell(3, column).value = header

# Existing user data means this is not a first-time blank template.
sheet["G4"] = "Wood"

red = Side(style="thin", color="FFFF0000")
white = PatternFill(fill_type="solid", fgColor="FFFFFFFF")

# Package Contains is initially red. Filling it triggers Special Feature.
workbook.defined_names.add(DefinedName("reqPackageContains", attr_text='Template!$H1=""'))
workbook.defined_names.add(DefinedName("reqDependent", attr_text='AND(LEN(Template!$H1)>0, Template!$I1="")'))
sheet.conditional_formatting.add(
    "H4:H1048576",
    FormulaRule(formula=["reqPackageContains"], fill=white, border=Border(left=red, right=red, top=red, bottom=red)),
)
sheet.conditional_formatting.add(
    "I4:I1048576",
    FormulaRule(formula=["reqDependent"], fill=white, border=Border(left=red, right=red, top=red, bottom=red)),
)

workbook.save(sys.argv[1])
`;
    execFileSync("python3", ["-c", fixtureScript, blank], { stdio: "pipe" });

    // Initial scan returns only the cell Excel currently renders white/red.
    const initialScan = JSON.parse(execFileSync(
      "python3",
      [automationScript, "scan_required_fields", blank],
      { encoding: "utf8" },
    ));
    assert.equal(initialScan.required_fields.length, 1);
    assert.equal(initialScan.required_fields[0].label, "Package Contains");

    // Reactive scan with Package Contains filled -> triggers dependent rule on Special Feature
    writeFileSync(fieldsPayload, JSON.stringify({
      field_values: {
        "package_contains[marketplace_id=ATVPDKIKX0DER]#1.value": "Gift Box",
      },
    }), "utf8");

    const reactiveScan = JSON.parse(execFileSync(
      "python3",
      [automationScript, "scan_required_fields", blank, fieldsPayload],
      { encoding: "utf8" },
    ));

    // Special Feature is newly triggered and unfilled, so it is returned for the user to fill!
    const fieldLabels = reactiveScan.required_fields.map((f: any) => f.label);
    assert.ok(fieldLabels.includes("Special Feature"));
    assert.equal(fieldLabels.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
