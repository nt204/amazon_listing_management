"use client";

import { useState } from "react";
import { PackageIcon } from "@phosphor-icons/react";
import type { TopProductItem } from "@/lib/accounting/dashboard-db";

interface TopSellingProductsProps {
  products?: TopProductItem[];
  scopeLabel?: string;
  onNavigateFinancials?: () => void;
  delay?: number;
}

function formatCurrency(val: number): string {
  const rounded = Math.round(val);
  const formatted = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatMargin(val: number): string {
  return `${val.toFixed(1)}%`;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex items-center justify-center" title="Hạng 1 - Huân chương Vàng">
        <svg
          className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(245,158,11,0.25)] transition-transform duration-200 hover:scale-110"
          viewBox="0 0 28 32"
          fill="none"
        >
          {/* Matching gold satin ribbons */}
          <path d="M8 17L5 30L11 27.5L15 30L13.5 17" fill="url(#goldRibbonL)" />
          <path d="M20 17L23 30L17 27.5L13 30L14.5 17" fill="url(#goldRibbonR)" />
          {/* Outer gold rim */}
          <circle cx="14" cy="13" r="11.5" fill="url(#goldBase)" stroke="#B45309" strokeWidth="0.75" />
          {/* Inner beveled ring */}
          <circle cx="14" cy="13" r="9.5" fill="url(#goldFace)" stroke="#FDE047" strokeWidth="0.75" />
          <circle cx="14" cy="13" r="8" stroke="#D97706" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.6" />
          {/* Number 1 */}
          <text
            x="14"
            y="17.2"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fill="#78350F"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            1
          </text>
          <defs>
            <linearGradient id="goldBase" x1="14" y1="1.5" x2="14" y2="24.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FDE047" />
              <stop offset="0.5" stopColor="#F59E0B" />
              <stop offset="1" stopColor="#B45309" />
            </linearGradient>
            <linearGradient id="goldFace" x1="14" y1="3.5" x2="14" y2="22.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FEF08A" />
              <stop offset="0.5" stopColor="#FBBF24" />
              <stop offset="1" stopColor="#D97706" />
            </linearGradient>
            <linearGradient id="goldRibbonL" x1="5" y1="17" x2="15" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#D97706" />
              <stop offset="1" stopColor="#92400E" />
            </linearGradient>
            <linearGradient id="goldRibbonR" x1="23" y1="17" x2="13" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#B45309" />
              <stop offset="1" stopColor="#78350F" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (rank === 2) {
    return (
      <div className="flex items-center justify-center" title="Hạng 2 - Huân chương Bạc">
        <svg
          className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(100,116,139,0.2)] transition-transform duration-200 hover:scale-110"
          viewBox="0 0 28 32"
          fill="none"
        >
          {/* Matching silver satin ribbons */}
          <path d="M8 17L5 30L11 27.5L15 30L13.5 17" fill="url(#silverRibbonL)" />
          <path d="M20 17L23 30L17 27.5L13 30L14.5 17" fill="url(#silverRibbonR)" />
          {/* Outer silver rim */}
          <circle cx="14" cy="13" r="11.5" fill="url(#silverBase)" stroke="#64748B" strokeWidth="0.75" />
          {/* Inner beveled ring */}
          <circle cx="14" cy="13" r="9.5" fill="url(#silverFace)" stroke="#FFFFFF" strokeWidth="0.75" />
          <circle cx="14" cy="13" r="8" stroke="#94A3B8" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.6" />
          {/* Number 2 */}
          <text
            x="14"
            y="17.2"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fill="#334155"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            2
          </text>
          <defs>
            <linearGradient id="silverBase" x1="14" y1="1.5" x2="14" y2="24.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F8FAFC" />
              <stop offset="0.5" stopColor="#CBD5E1" />
              <stop offset="1" stopColor="#64748B" />
            </linearGradient>
            <linearGradient id="silverFace" x1="14" y1="3.5" x2="14" y2="22.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="0.5" stopColor="#E2E8F0" />
              <stop offset="1" stopColor="#94A3B8" />
            </linearGradient>
            <linearGradient id="silverRibbonL" x1="5" y1="17" x2="15" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#94A3B8" />
              <stop offset="1" stopColor="#475569" />
            </linearGradient>
            <linearGradient id="silverRibbonR" x1="23" y1="17" x2="13" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#64748B" />
              <stop offset="1" stopColor="#334155" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (rank === 3) {
    return (
      <div className="flex items-center justify-center" title="Hạng 3 - Huân chương Đồng">
        <svg
          className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(194,65,12,0.2)] transition-transform duration-200 hover:scale-110"
          viewBox="0 0 28 32"
          fill="none"
        >
          {/* Matching bronze satin ribbons */}
          <path d="M8 17L5 30L11 27.5L15 30L13.5 17" fill="url(#bronzeRibbonL)" />
          <path d="M20 17L23 30L17 27.5L13 30L14.5 17" fill="url(#bronzeRibbonR)" />
          {/* Outer bronze rim */}
          <circle cx="14" cy="13" r="11.5" fill="url(#bronzeBase)" stroke="#9A3412" strokeWidth="0.75" />
          {/* Inner beveled ring */}
          <circle cx="14" cy="13" r="9.5" fill="url(#bronzeFace)" stroke="#FFEDD5" strokeWidth="0.75" />
          <circle cx="14" cy="13" r="8" stroke="#C2410C" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.6" />
          {/* Number 3 */}
          <text
            x="14"
            y="17.2"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fill="#431407"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            3
          </text>
          <defs>
            <linearGradient id="bronzeBase" x1="14" y1="1.5" x2="14" y2="24.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FDBA74" />
              <stop offset="0.5" stopColor="#FB923C" />
              <stop offset="1" stopColor="#9A3412" />
            </linearGradient>
            <linearGradient id="bronzeFace" x1="14" y1="3.5" x2="14" y2="22.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFEDD5" />
              <stop offset="0.5" stopColor="#F97316" />
              <stop offset="1" stopColor="#C2410C" />
            </linearGradient>
            <linearGradient id="bronzeRibbonL" x1="5" y1="17" x2="15" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#C2410C" />
              <stop offset="1" stopColor="#7C2D12" />
            </linearGradient>
            <linearGradient id="bronzeRibbonR" x1="23" y1="17" x2="13" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#9A3412" />
              <stop offset="1" stopColor="#431407" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-slate-100 font-semibold text-xs text-slate-500">
        {rank}
      </span>
    </div>
  );
}

function ProductThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-100 text-slate-400">
        <PackageIcon size={22} weight="duotone" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setError(true)}
      loading="lazy"
      className="h-11 w-11 shrink-0 rounded-lg border border-slate-200/80 bg-white object-contain p-0.5 shadow-2xs transition-transform duration-200 hover:scale-105"
    />
  );
}

export function TopSellingProducts({
  products = [],
  delay = 160,
}: TopSellingProductsProps) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className="acc-rise flex h-full flex-col rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]"
    >
      {/* Header */}
      <div className="pb-3">
        <h2 className="text-lg font-bold tracking-tight text-slate-900">
          Top Selling Products (by <span className="text-emerald-600 font-extrabold">Profit</span>)
        </h2>
      </div>

      {/* Table content */}
      {products.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <PackageIcon size={24} weight="duotone" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-700">Chưa có dữ liệu sản phẩm</p>
          <p className="mt-1 text-xs text-slate-400">
            Không tìm thấy đơn hàng nào trong khoảng thời gian hoặc bộ lọc đã chọn.
          </p>
        </div>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/90 text-[12px] font-semibold text-slate-500">
                <th className="rounded-l-lg py-2.5 pl-3 pr-2 text-center w-12">#</th>
                <th className="py-2.5 px-3">Product / SKU</th>
                <th className="py-2.5 px-3 text-right">Units</th>
                <th className="py-2.5 px-3 text-right">Revenue</th>
                <th className="py-2.5 px-3 text-right text-emerald-600 font-bold">Profit</th>
                <th className="rounded-r-lg py-2.5 pl-3 pr-4 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[13px]">
              {products.map((p, index) => {
                const rank = index + 1;
                const isPositive = p.netProfit >= 0;

                return (
                  <tr
                    key={`${p.storeId}-${p.sku}`}
                    className="group transition-colors hover:bg-slate-50/60"
                  >
                    {/* Rank 1, 2, 3 with custom vector medal, 4 & 5 with clean circular pill */}
                    <td className="py-3 pl-3 pr-2 text-center align-middle">
                      <RankBadge rank={rank} />
                    </td>

                    {/* Product image, name, SKU */}
                    <td className="py-3 px-3 align-middle">
                      <div className="flex items-center gap-3">
                        <ProductThumbnail src={p.imageUrl} alt={p.productName} />
                        <div className="min-w-0 max-w-[260px] sm:max-w-[340px]">
                          <p
                            title={p.productName}
                            className="truncate text-[13px] font-semibold text-slate-800 transition-colors group-hover:text-blue-600"
                          >
                            {p.productName}
                          </p>
                          <p className="mt-0.5 font-mono text-[11.5px] font-medium text-slate-500">
                            {p.sku}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Units */}
                    <td className="py-3 px-3 text-right font-medium text-slate-700 align-middle tabular-nums text-sm">
                      {p.units.toLocaleString("en-US")}
                    </td>

                    {/* Revenue */}
                    <td className="py-3 px-3 text-right font-semibold text-slate-800 align-middle tabular-nums text-sm">
                      {formatCurrency(p.revenue)}
                    </td>

                    {/* Profit: Vibrant Green */}
                    <td
                      className="py-3 px-3 text-right font-bold align-middle tabular-nums text-sm"
                      style={{ color: isPositive ? "#16a34a" : "#e11d48" }}
                    >
                      {formatCurrency(p.netProfit)}
                    </td>

                    {/* Margin: Black / Dark Neutral */}
                    <td className="py-3 pl-3 pr-4 text-right font-semibold text-slate-800 align-middle tabular-nums text-sm">
                      {formatMargin(p.margin)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
