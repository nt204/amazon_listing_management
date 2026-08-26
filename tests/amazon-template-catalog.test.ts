import assert from "node:assert/strict";
import test from "node:test";
import {
  findTemplateMappingSource,
  findTemplateVariant,
  inferPhoiName,
  isTemplateReady,
  normalizePhoiKey,
  templateWorkbookDownloadName,
  templatesForBrandCatalog,
} from "@/lib/amazon-template-catalog";
import type { ListingTemplateSummary } from "@/lib/types";

const metadata = {
  sheet_name: "Template",
  attribute_row: 3,
  label_row: 2,
  data_row: 4,
  column_count: 20,
  last_column: "T",
  source_parent_row: 4,
  source_child_row: 5,
  content_columns: { sku: "A", title: "B", description: "C", bullet_points: ["D"], generic_keywords: "E", main_image: "F" },
  defaults: { material: "", size_capacity: "", color: "", package_contents: "", features: [], country_of_origin: "" },
};

function template(overrides: Partial<ListingTemplateSummary>): ListingTemplateSummary {
  return {
    id: "template-a",
    shop_id: "shop-a",
    shop_name: "Fastpeace",
    shop_is_unassigned: false,
    brand_profile_id: null,
    brand_name: "Limima",
    phoi_name: "Hanging Ornament",
    phoi_key: "hanging-ornament",
    source_template_id: null,
    is_auto_mapped: false,
    is_ready: true,
    name: "Fastpeace - Hanging Ornament",
    original_filename: "Hanging Ornament.xlsx",
    file_extension: ".xlsx",
    product_type: "ornament",
    metadata,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

test("template scan names files as shop plus phoi", () => {
  assert.equal(inferPhoiName("AOTT0731: Hanging Ornament.xlsx", "Fastpeace", "ornament"), "Hanging Ornament");
  assert.equal(inferPhoiName("Fastpeace - Glass Ornament.xlsm", "Fastpeace", "ornament"), "Glass Ornament");
  assert.equal(normalizePhoiKey("Glass Ornament"), "glass-ornament");
});

test("catalog shows only templates belonging to the selected Brand account", () => {
  const templates = [
    template({ id: "limima" }),
    template({
      id: "brand-b",
      shop_id: "shop-b",
      shop_name: "Brand B",
      brand_profile_id: "brand-b",
      brand_name: "Brand B",
    }),
    template({ id: "mug", phoi_name: "Mug", phoi_key: "mug", name: "Fastpeace - Mug" }),
  ];
  const catalog = templatesForBrandCatalog(templates, { id: "brand-b", name: "Brand B" });
  assert.deepEqual(catalog.map((item) => item.id), ["brand-b"]);
});

test("missing brand and phoi variant finds the same phoi from another shop", () => {
  const selected = template({ id: "shop-b-blank", shop_id: "shop-b", shop_name: "Shop B" });
  const otherShopSource = template({ id: "shop-a-source", shop_id: "shop-a", shop_name: "Shop A" });
  const existingBrandVariant = template({
    id: "brand-b-existing",
    shop_id: "shop-b",
    shop_name: "Shop B",
    brand_profile_id: "brand-b",
    brand_name: "Brand B",
  });
  const brand = { id: "brand-b", name: "Brand B" };

  assert.equal(findTemplateVariant([selected, existingBrandVariant], selected, brand)?.id, "brand-b-existing");
  assert.equal(findTemplateMappingSource([selected, otherShopSource], selected, brand).id, "shop-a-source");
});

test("isTemplateReady distinguishes ready filled templates from unmapped blank templates", () => {
  const readyTmpl = template({ id: "ready", is_ready: true });
  const blankTmpl = template({
    id: "blank",
    is_ready: false,
    metadata: {
      ...metadata,
      is_blank: true,
      is_ready: false,
      source_parent_row: 0,
      source_child_row: 0,
    },
  });

  assert.equal(isTemplateReady(readyTmpl), true);
  assert.equal(isTemplateReady(blankTmpl), false);
  assert.equal(isTemplateReady(null), false);
});

test("template download names preserve the shop and phoi without unsafe filename characters", () => {
  assert.equal(
    templateWorkbookDownloadName({ name: "Warmstorey / Hanging: Ornament", file_extension: ".xlsx" }),
    "Warmstorey - Hanging- Ornament.xlsx",
  );
  assert.equal(
    templateWorkbookDownloadName({ name: "Fastpeace - Mug.xlsx", file_extension: ".xlsm" }),
    "Fastpeace - Mug.xlsm",
  );
});
