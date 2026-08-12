import type { ListingInput, ListingTemplateSummary, StoredListing } from "@/lib/types";

export interface ExcelSkuRow {
  source_row: number;
  sku: string;
  main_keyword: string;
  generic_keywords: string;
  image_urls: string[];
}

export interface ExcelImportResult {
  sheet_name: string;
  header_row: number;
  rows: ExcelSkuRow[];
  warnings: string[];
}

export interface AmazonTemplateItem {
  sku: string;
  image_urls: string[];
  brand: string;
  listing: StoredListing["current_listing"];
  product_information?: ListingInput["product_information"];
}

export function splitGenericKeywords(value: string) {
  return value
    .split(/[|;\n\r]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function buildExcelListingInput(
  base: ListingInput,
  row: ExcelSkuRow,
  images: ListingInput["images"],
  template: ListingTemplateSummary,
): ListingInput {
  const defaults = template.metadata.defaults;

  return {
    marketplace: "US",
    product_type: template.name,
    internal_name: row.sku,
    brand: base.brand,
    brand_profile_id: base.brand_profile_id || "",
    brand_guidelines: base.brand_guidelines || "",
    product_information: {
      material: defaults.material,
      size_capacity: defaults.size_capacity,
      color: defaults.color,
      package_contents: defaults.package_contents,
      features: [...defaults.features],
      personalization: "",
      care_instructions: "",
      country_of_origin: defaults.country_of_origin,
    },
    main_keyword: row.main_keyword,
    related_keywords: [],
    backend_keywords: splitGenericKeywords(row.generic_keywords),
    research: {
      target_customer: "",
      gift_giver: "",
      occasion: [],
      customer_insight: "",
      usp: "",
      competitor_asins: [],
      competitor_notes: "",
      notes: [
        `Internal SKU: ${row.sku}`,
        `Selected Amazon template: ${template.name} (${template.original_filename})`,
        "Use only facts supported by the supplied product images and product information.",
      ].join("\n"),
    },
    images,
    configuration: {
      ...base.configuration,
      bullet_count: 5,
      title_length: 200,
      bullet_length: 300,
      generate_description: true,
      generate_search_terms: true,
    },
  };
}

export function toAmazonTemplateItem(
  row: ExcelSkuRow,
  listing: StoredListing,
): AmazonTemplateItem {
  return {
    sku: row.sku,
    image_urls: row.image_urls,
    brand: listing.input.brand,
    listing: listing.current_listing,
    product_information: listing.input.product_information,
  };
}
