import type { SkuChannel } from "@/lib/accounting/inventory-db";

// Màu tab đang chọn theo kênh, dùng chung cho mọi mục có tab FBA/FBM (Inventory, Financials)
// để cùng một kênh luôn cùng một màu. Theo quy ước FBA xanh dương / FBM tím của bảng Top sản phẩm.
export function channelTabActiveClass(channel: SkuChannel) {
  return channel === "fbm"
    ? "bg-violet-600 text-white shadow-2xs border-violet-700"
    : "bg-sky-600 text-white shadow-2xs border-sky-700";
}

export function channelTabBadgeActiveClass(channel: SkuChannel) {
  return channel === "fbm" ? "bg-violet-700 text-white" : "bg-sky-700 text-white";
}
