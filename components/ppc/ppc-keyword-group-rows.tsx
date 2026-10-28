"use client";

// Bảng tổng phía trên tab Target / Search Term khi tìm theo SKU: mỗi keyword 1 dòng tổng (gộp mọi campaign / match type).
// Cùng 11 cột với bảng tổng: Ảnh | SKU | Keyword | Hiển thị | Clicks | CTR | Spend | Sales | Orders | CVR | ACOS.

export type KeywordGroupRow = {
  targetKeyword?: string;
  customerSearchTerm?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
};

export function PpcKeywordGroupRows({ groups, total }: { groups: KeywordGroupRow[]; total: number }) {
  return (
    <>
      {groups.map((group) => {
        const keyword = group.targetKeyword ?? group.customerSearchTerm ?? "";
        const noSales = group.orders === 0 || group.sales === 0;
        return (
          <tr key={keyword} className="hover:bg-slate-50/70">
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-sm font-semibold text-slate-800 break-words">{keyword}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-700">{Number(group.impressions || 0).toLocaleString("vi-VN")}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-700">{Number(group.clicks || 0).toLocaleString("vi-VN")}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-600">
              {group.impressions > 0 ? ((group.clicks / group.impressions) * 100).toFixed(2) : "0.00"}%
            </td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-900">${Number(group.spend || 0).toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-emerald-600">${Number(group.sales || 0).toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-900">{Number(group.orders || 0).toLocaleString("vi-VN")}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-600">
              {group.clicks > 0 ? ((group.orders / group.clicks) * 100).toFixed(1) : "0.0"}%
            </td>
            <td className="px-3 py-2 text-right">
              <span
                className={`inline-flex min-w-[64px] justify-center rounded-md px-2 py-0.5 font-mono text-xs font-black ${
                  noSales
                    ? group.spend > 0 ? "bg-rose-100 text-rose-700" : "text-slate-400"
                    : group.acos < 30
                      ? "bg-emerald-100 text-emerald-700"
                      : group.acos <= 50
                        ? "bg-amber-200 text-amber-900"
                        : "bg-rose-100 text-rose-700"
                }`}
              >
                {noSales ? (group.spend > 0 ? "0 sales" : "—") : `${Number(group.acos || 0).toFixed(1)}%`}
              </span>
            </td>
          </tr>
        );
      })}
      {total > groups.length && (
        <tr>
          <td colSpan={11} className="px-3 py-2 text-center text-[11px] text-slate-400">
            Hiển thị {groups.length.toLocaleString("vi-VN")}/{total.toLocaleString("vi-VN")} keyword có spend cao nhất
          </td>
        </tr>
      )}
    </>
  );
}
