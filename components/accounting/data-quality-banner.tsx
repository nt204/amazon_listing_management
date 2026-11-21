"use client";

import { useEffect, useState } from "react";
import { CaretDownIcon, CaretRightIcon, CheckCircleIcon, CircleNotchIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react";

// Dải "Cảnh báo dữ liệu" ở đầu khung AI đối soát: các lỗi / thiếu dữ liệu của phạm vi đang xem (chạy bằng code, không
// gọi AI — GET /api/accounting/data-checks). Hiện 1 lần ở đây để câu trả lời của AI không phải nhắc lại mỗi lượt.

interface DataIssue {
  id: string;
  title: string;
  status: "warning" | "info";
  summary: string;
  impact?: string;
  items?: Record<string, unknown>[];
}

export interface DataQualityBannerProps {
  startDate: string;
  endDate: string;
  storeIds?: string[];
  team?: string;
  /** Bấm "Hỏi AI" trên một cảnh báo. */
  onAsk?: (question: string) => void;
}

/** Ví dụ ngắn của 1 cảnh báo: "SKU GOC070825B1 (FASTPEACE)". */
function sampleOf(issue: DataIssue): string | null {
  const first = issue.items?.[0];
  if (!first) return null;
  const label = first.sku ?? first.portfolio ?? first.currency ?? first.dates ?? null;
  if (label == null) return null;
  const more = (issue.items?.length ?? 0) > 1 ? ` và ${issue.items!.length - 1} mục khác` : "";
  return `${String(label)}${first.store ? ` (${String(first.store)})` : ""}${more}`;
}

export function DataQualityBanner({ startDate, endDate, storeIds, team, onAsk }: DataQualityBannerProps) {
  const [open, setOpen] = useState(false);
  const storeKey = (storeIds ?? []).join(",");
  const queryKey = `${startDate}|${endDate}|${storeKey}|${team ?? ""}`;
  // Kết quả gắn với khóa phạm vi: đổi store / kỳ thì kết quả cũ tự thành "đang tải" (không setState trong effect).
  const [result, setResult] = useState<{ key: string; issues: DataIssue[] | null } | null>(null);

  useEffect(() => {
    if (!startDate || !endDate) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
    if (storeKey) params.set("store_ids", storeKey);
    if (team) params.set("team", team);
    fetch(`/api/accounting/data-checks?${params}`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { issues: DataIssue[] }) => setResult({ key: queryKey, issues: data.issues }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: queryKey, issues: null });
      });
    return () => controller.abort();
  }, [startDate, endDate, storeKey, team, queryKey]);

  const loading = result?.key !== queryKey;
  const issues = loading ? null : result.issues;
  if (!startDate || !endDate || (!loading && issues === null)) return null;

  if (loading || issues === null) {
    return (
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2 text-[11.5px] text-slate-400">
        <CircleNotchIcon size={12} className="animate-spin" /> Đang kiểm tra dữ liệu kỳ này…
      </div>
    );
  }

  const warnings = issues.filter((i) => i.status === "warning");
  const notes = issues.filter((i) => i.status === "info");
  if (!issues.length) {
    return (
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-emerald-50/60 px-4 py-2 text-[11.5px] font-semibold text-emerald-700">
        <CheckCircleIcon size={14} weight="fill" /> Dữ liệu kỳ này đầy đủ, không phát hiện lỗi.
      </div>
    );
  }

  return (
    <div className={`border-b ${warnings.length ? "border-amber-200 bg-amber-50/70" : "border-slate-100 bg-slate-50"}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-left text-[11.5px] font-semibold"
      >
        {warnings.length ? (
          <WarningIcon size={14} weight="fill" className="shrink-0 text-amber-600" />
        ) : (
          <InfoIcon size={14} weight="fill" className="shrink-0 text-slate-400" />
        )}
        <span className={warnings.length ? "text-amber-800" : "text-slate-600"}>
          {warnings.length ? `${warnings.length} lỗi dữ liệu có thể làm sai số` : "Không có lỗi dữ liệu"}
          {notes.length ? ` · ${notes.length} lưu ý` : ""}
        </span>
        <span className="ml-auto text-slate-400">{open ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}</span>
      </button>
      {open && (
        <ul className="max-h-[38vh] space-y-2 overflow-y-auto px-4 pb-3">
          {[...warnings, ...notes].map((issue) => {
            const sample = sampleOf(issue);
            return (
              <li key={issue.id} className="rounded-xl bg-white/80 px-3 py-2 text-[11.5px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
                <div className="flex items-start justify-between gap-2">
                  <span className={`font-bold ${issue.status === "warning" ? "text-amber-800" : "text-slate-700"}`}>{issue.title}</span>
                  {onAsk && (
                    <button
                      onClick={() => onAsk(`${issue.title}: chi tiết thế nào, ảnh hưởng số nào và cần sửa ở đâu?`)}
                      className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[10.5px] font-bold text-indigo-600 hover:bg-indigo-50"
                    >
                      Hỏi AI
                    </button>
                  )}
                </div>
                <p>{issue.summary}</p>
                {issue.impact && <p className="font-semibold text-slate-700">{issue.impact}</p>}
                {sample && <p className="text-slate-400">Ví dụ: {sample}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
