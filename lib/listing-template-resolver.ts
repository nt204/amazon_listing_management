import "server-only";

import {
  findTemplateVariant,
  normalizePhoiKey,
  templateMatchesBrand,
  type TemplateBrandIdentity,
} from "@/lib/amazon-template-catalog";
import { getListingTemplate, listListingTemplates, type DataScope } from "@/lib/db";

export async function resolveListingTemplateForBrand(
  scope: DataScope,
  selectedTemplateId: string,
  brand: TemplateBrandIdentity,
) {
  const selected = await getListingTemplate(scope, selectedTemplateId);
  if (!selected || selected.shop_is_unassigned) return null;
  if (templateMatchesBrand(selected, brand)) return selected;

  const catalog = await listListingTemplates(scope);
  const phoiKey = selected.phoi_key || normalizePhoiKey(selected.phoi_name || selected.name);
  const exact = findTemplateVariant(catalog, { ...selected, phoi_key: phoiKey }, brand);
  if (exact) return getListingTemplate(scope, exact.id);
  return null;
}
