import type { ListingTemplateSummary } from "@/lib/types";

type ShopBoundTemplate = Pick<ListingTemplateSummary, "shop_id" | "shop_is_unassigned">;

export function isTemplateForShop(template: ShopBoundTemplate, shopId: string) {
  return Boolean(shopId) && !template.shop_is_unassigned && template.shop_id === shopId;
}

export function templatesForShop<T extends ShopBoundTemplate>(templates: readonly T[], shopId: string) {
  return templates.filter((template) => isTemplateForShop(template, shopId));
}
