import type { ListingTemplateSummary } from "@/lib/types";

export interface TemplateBrandIdentity {
  id?: string;
  name: string;
}

export function normalizePhoiKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferPhoiName(filename: string, shopName = "", productType = "") {
  let name = filename.replace(/\.(xlsx|xlsm)$/i, "").trim();
  if (shopName) {
    name = name.replace(new RegExp(`^${escapeRegExp(shopName)}[\s_-]*`, "i"), "").trim();
  }
  const separatorIndex = name.indexOf(":");
  if (separatorIndex >= 0) {
    const prefix = name.slice(0, separatorIndex).trim();
    if (/^[A-Z0-9]{5,20}$/i.test(prefix) && /[A-Z]/i.test(prefix) && /\d/.test(prefix)) {
      name = name.slice(separatorIndex + 1).trim();
    }
  }
  name = name.replace(/^[\s_-]+|[\s_-]+$/g, "").trim();
  if (!name || /^(amazon[\s_-]*)?(flat[\s_-]*)?template$/i.test(name)) {
    name = productType.replace(/[_-]+/g, " ").trim();
  }
  return name || "Amazon Template";
}

export function templateMatchesBrand(
  template: Pick<ListingTemplateSummary, "brand_profile_id" | "brand_name">,
  brand: TemplateBrandIdentity,
) {
  if (brand.id && template.brand_profile_id) return template.brand_profile_id === brand.id;
  if (brand.name && template.brand_name) {
    return template.brand_name.trim().localeCompare(brand.name.trim(), undefined, { sensitivity: "accent" }) === 0;
  }
  return false;
}

export function templatesForBrandCatalog(
  templates: readonly ListingTemplateSummary[],
  brand: TemplateBrandIdentity,
) {
  return templates
    .filter((template) => !template.shop_is_unassigned && templateMatchesBrand(template, brand))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findTemplateVariant(
  templates: readonly ListingTemplateSummary[],
  selected: ListingTemplateSummary,
  brand: TemplateBrandIdentity,
) {
  return templates.find((template) =>
    template.phoi_key === selected.phoi_key
    && templateMatchesBrand(template, brand),
  );
}

export function findTemplateMappingSource(
  templates: readonly ListingTemplateSummary[],
  selected: ListingTemplateSummary,
  brand: TemplateBrandIdentity,
) {
  const compatible = templates.filter((template) =>
    !template.shop_is_unassigned && template.phoi_key === selected.phoi_key,
  );
  return compatible.find((template) =>
    template.shop_id !== selected.shop_id && templateMatchesBrand(template, brand),
  ) || compatible.find((template) => template.shop_id !== selected.shop_id)
    || compatible.find((template) => templateMatchesBrand(template, brand))
    || selected;
}

export function isTemplateReady(template: ListingTemplateSummary | null | undefined): boolean {
  if (!template) return false;
  if (typeof template.is_ready === "boolean") return template.is_ready;
  const meta = template.metadata;
  if (!meta) return false;
  if (meta.is_blank) return false;
  if (meta.is_ready === false) return false;
  return Boolean(meta.source_parent_row && meta.source_child_row);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
