export const ACCOUNTING_FRESHNESS_VIEWS = [
  "dashboard", "daily", "weekly", "monthly", "sku-results", "testing", "kpi", "sku", "inbound",
  "shipments", "base-cost", "stock", "orders", "ads", "returns", "fees", "stores", "payout", "files", "access",
] as const;

export type AccountingFreshnessView = (typeof ACCOUNTING_FRESHNESS_VIEWS)[number];
export type AccountingStockPeriod = "day" | "week" | "month";

export type AccountingFreshness = {
  dataAt: string | null;
  stock: { period: AccountingStockPeriod; at: string } | null;
};
