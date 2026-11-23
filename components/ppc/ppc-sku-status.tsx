"use client";

import { PpcFilterDropdown } from "./ppc-filter-dropdown";
import { getSkuStatus, SKU_STATUSES, type SkuStatusFilter } from "@/lib/ppc/sku-status";

const statusClasses = {
  WIN: "bg-emerald-600",
  TEST: "bg-amber-500",
  FAIL: "bg-rose-600",
};

const statusOptions = [
  { value: "ALL", label: "Tất cả trạng thái" } as const,
  ...SKU_STATUSES.map((status) => ({ value: status, label: status })),
];

export function PpcSkuStatusBadge({ status }: { status?: string | null }) {
  const label = getSkuStatus(status);

  if (!label) return null;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block size-2 shrink-0 rounded-full align-middle ${statusClasses[label]}`}
    />
  );
}

export function PpcSkuStatusFilter({ value, onChange }: {
  value: SkuStatusFilter;
  onChange: (value: SkuStatusFilter) => void;
}) {
  return <PpcFilterDropdown label="Lọc theo trạng thái SKU" options={statusOptions} value={value} onChange={onChange} />;
}
