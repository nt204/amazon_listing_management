"use client";

import { useEffect, useMemo, useState } from "react";

interface SkuUnitTrends {
  dates: string[];
  series: Record<string, number[]>;
}

const trendKey = (sku: string) => sku.trim().toUpperCase();

/**
 * Units theo ngày cho các SKU đang hiển thị: tải riêng sau bảng (bảng không phải chờ),
 * giữ kết quả theo bộ lọc để quay lại trang cũ hiện ngay.
 */
export function useSkuUnitTrends(options: {
  storeId: string;
  channel: "fba" | "fbm";
  startDate: string;
  endDate: string;
  skus: string[];
  enabled?: boolean;
}) {
  const { storeId, channel, startDate, endDate, skus, enabled = true } = options;
  const skuList = useMemo(() => [...new Set(skus.map(trendKey))].sort().join(","), [skus]);
  const queryKey = `${storeId}|${channel}|${startDate}|${endDate}|${skuList}`;
  const [cache, setCache] = useState<Record<string, SkuUnitTrends>>({});
  const ready = enabled && Boolean(storeId && startDate && endDate && skuList);

  useEffect(() => {
    if (!ready || cache[queryKey]) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ store_id: storeId, start_date: startDate, end_date: endDate, skus: skuList });
    if (channel === "fbm") params.set("channel", "fbm");
    fetch(`/api/accounting/financials/sku-trend?${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SkuUnitTrends | null) => {
        if (data) setCache((prev) => ({ ...prev, [queryKey]: data }));
      })
      .catch(() => {
        // Biểu đồ phụ: lỗi thì để ô trống, không chặn bảng
      });
    return () => controller.abort();
  }, [ready, cache, queryKey, storeId, channel, startDate, endDate, skuList]);

  const data = ready ? cache[queryKey] : undefined;
  return useMemo(
    () => (data ? (sku: string) => data.series[trendKey(sku)] ?? new Array<number>(data.dates.length).fill(0) : null),
    [data],
  );
}

const WIDTH = 88;
const HEIGHT = 24;
const PAD = 2;

/** Biểu đồ units nhỏ (SVG thuần, không dùng thư viện chart để 50–200 dòng vẫn nhẹ). */
export function UnitsSparkline({ data }: { data: number[] | null | undefined }) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data);
    if (max <= 0) return null;
    const step = (WIDTH - PAD * 2) / (data.length - 1);
    const points = data.map((v, i) => [PAD + i * step, HEIGHT - PAD - (v / max) * (HEIGHT - PAD * 2)] as const);
    const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    return { line, area: `${line}L${points[points.length - 1][0].toFixed(1)},${HEIGHT}L${PAD},${HEIGHT}Z` };
  }, [data]);

  if (data === undefined) return <span className="inline-block h-6 w-[88px] animate-pulse rounded bg-slate-100" />;
  if (!path) return <span className="text-slate-300">—</span>;
  const total = data!.reduce((a, b) => a + b, 0);
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="inline-block align-middle" aria-label={`${total} units`}>
      <title>{`${total.toLocaleString("en-US")} units`}</title>
      <path d={path.area} fill="#3b82f6" fillOpacity={0.12} />
      <path d={path.line} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
