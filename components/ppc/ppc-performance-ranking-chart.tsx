"use client";

import React, { useMemo } from "react";
import type { PpcCampaignPerformance } from "@/lib/ppc/types";

export interface PpcPerformanceRankingChartProps {
  campaigns: PpcCampaignPerformance[];
  targetAcos?: number;
  currency?: string;
  onSelectCampaign?: (campaignId: string) => void;
  onFilterGroup?: (group: "BLEEDING" | "HIGH_ACOS" | "GOOD") => void;
}

interface FormatGroupRow {
  key: string;
  name: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
  cvr: number;
  acos: number;
  spendShare: number;
}

export function PpcPerformanceRankingChart({
  campaigns,
  targetAcos = 30,
  currency = "$",
}: PpcPerformanceRankingChartProps) {
  // Tổng spend của toàn bộ campaign để tính tỉ trọng
  const totalAllSpend = useMemo(() => {
    return Math.max(1, campaigns.reduce((sum, c) => sum + c.spend, 0));
  }, [campaigns]);

  // =========================================================================
  // DỮ LIỆU SO SÁNH THEO DẠNG CHẠY (CHỈ HIỂN THỊ CÁC DẠNG CÓ PHÁT SINH)
  // =========================================================================
  const formatRows = useMemo<FormatGroupRow[]>(() => {
    const buckets: Record<
      string,
      {
        name: string;
        spend: number;
        sales: number;
        orders: number;
        clicks: number;
        impressions: number;
      }
    > = {};

    campaigns.forEach((c) => {
      const name = c.campaignName || "";
      let key = "OTHER";
      let formatName = "Khác";

      // 1. Sponsored Brands & Display
      if (/SB05|\bVIDEO\b/i.test(name)) {
        key = "SB05";
        formatName = "SB05 · Video";
      } else if (/SB01|Collection/i.test(name)) {
        key = "SB01";
        formatName = "SB01 · Collection";
      } else if (c.adType === "SB" || /\bSB\b|Sponsored Brands/i.test(name)) {
        key = "SB_GEN";
        formatName = "SB · Sponsored Brands";
      } else if (c.adType === "SD" || /\bSD\b|Sponsored Display/i.test(name)) {
        key = "SD";
        formatName = "SD · Display";
      // 2. Sponsored Products (SP01, SP02, SP03, SP04 Auto)
      } else if (/SP03/i.test(name)) {
        key = "SP03";
        formatName = "SP03 · KW (product-keyword)";
      } else if (/SP01/i.test(name)) {
        key = "SP01";
        formatName = "SP01 · Broad";
      } else if (/SP02/i.test(name)) {
        key = "SP02";
        formatName = "SP02 · Exact";
      } else if (/SP04|\bauto\b/i.test(name)) {
        // Sử dụng \bauto\b để không bắt nhầm các từ như Automotive
        key = "SP04";
        formatName = "SP04 · Auto";
      }

      if (!buckets[key]) {
        buckets[key] = { name: formatName, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
      }
      buckets[key].spend += c.spend || 0;
      buckets[key].sales += c.sales || 0;
      buckets[key].orders += c.orders || 0;
      buckets[key].clicks += c.clicks || 0;
      buckets[key].impressions += c.impressions || 0;
    });

    return Object.entries(buckets)
      .map(([key, b]) => {
        const cpc = b.clicks > 0 ? b.spend / b.clicks : 0;
        const ctr = b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
        const cvr = b.clicks > 0 ? (b.orders / b.clicks) * 100 : 0;
        const acos = b.sales > 0 ? (b.spend / b.sales) * 100 : b.spend > 0 ? 999 : 0;
        const spendShare = (b.spend / totalAllSpend) * 100;
        return {
          key,
          name: b.name,
          impressions: b.impressions,
          clicks: b.clicks,
          ctr,
          spend: b.spend,
          sales: b.sales,
          orders: b.orders,
          cpc,
          cvr,
          acos,
          spendShare,
        };
      })
      .filter((r) => r.spend > 0 || r.orders > 0 || r.impressions > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [campaigns, totalAllSpend]);

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
          SO SÁNH DẠNG CHẠY (SP03 · SP04 AUTO · SB01 · SB05...)
        </h4>
        <span className="text-[11px] font-bold text-slate-400">
          {formatRows.length} dạng chạy đang phát sinh chi tiêu / hiển thị
        </span>
      </div>

      {/* Bảng dữ liệu đồng bộ phong cách */}
      <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3.5">Dạng Chạy</th>
              <th className="py-2.5 px-2.5 text-right font-bold text-slate-700">Impressions</th>
              <th className="py-2.5 px-2.5 text-right">Clicks</th>
              <th className="py-2.5 px-2.5 text-right">CTR</th>
              <th className="py-2.5 px-2.5 text-right">Spend</th>
              <th className="py-2.5 px-2.5 text-right font-black text-emerald-700">Sales</th>
              <th className="py-2.5 px-2.5 text-right">Orders</th>
              <th className="py-2.5 px-2.5 text-right">ACOS</th>
              <th className="py-2.5 px-2.5 text-right">CVR</th>
              <th className="py-2.5 px-2.5 text-right">CPC</th>
              <th className="py-2.5 px-3.5 text-left w-36">Tỉ Trọng Spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {formatRows.map((row) => {
              const isGood = row.sales > 0 && row.acos <= targetAcos;
              return (
                <tr key={row.key} className="hover:bg-slate-50/60 transition">
                  <td className="py-2.5 px-3.5 font-bold text-slate-900">
                    {row.name}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-700">
                    {row.impressions.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-slate-600">
                    {row.clicks.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-slate-600">
                    {row.impressions > 0 ? `${row.ctr.toFixed(2)}%` : "—"}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900">
                    {currency}{row.spend.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono font-black text-emerald-600">
                    {currency}{row.sales.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900">
                    {row.orders}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono font-bold">
                    {row.sales === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                          isGood
                            ? "bg-emerald-50 text-emerald-700"
                            : row.acos > targetAcos * 1.3
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {row.acos.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-slate-700">
                    {row.cvr.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-slate-600">
                    {currency}{row.cpc.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(2, row.spendShare))}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-bold text-slate-600 w-8 text-right">
                        {row.spendShare.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
