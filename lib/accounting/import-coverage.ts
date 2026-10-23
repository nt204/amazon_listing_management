export interface ImportCoverage {
  start: string;
  end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeImportCoverage(
  startValue: unknown,
  endValue: unknown,
): ImportCoverage | undefined {
  if (startValue == null && endValue == null) return undefined;
  const start = String(startValue || "").trim();
  const end = String(endValue || "").trim();
  if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end) {
    throw new Error("Vùng ngày báo cáo không hợp lệ (coverage_start/coverage_end phải là YYYY-MM-DD).");
  }
  return { start, end };
}

export function assertRowsInsideCoverage(
  rows: Array<{ date?: string | null }>,
  coverage?: ImportCoverage,
): void {
  if (!coverage) return;
  const outside = rows.find((row) => row.date && (row.date < coverage.start || row.date > coverage.end));
  if (outside) {
    throw new Error(`File có ngày ${outside.date} nằm ngoài vùng báo cáo ${coverage.start}..${coverage.end}.`);
  }
}

export function coverageFromAccountingFileName(
  fileName: string,
  kind: "orders" | "ads" | "returns",
): ImportCoverage | undefined {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2})(?!.*\d{4}-\d{2}-\d{2})/);
  if (!match) return undefined;
  const end = match[1];
  if (kind !== "returns") return { start: end, end };
  const startDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) return undefined;
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  return { start: startDate.toISOString().slice(0, 10), end };
}
