"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import type { SkuEconomics } from "@/lib/ppc/sku-architecture-types";

interface PpcSkuMappingPanelProps {
  skuList: SkuEconomics[];
  onSave: (mappings: Array<{ sku: string; productType: string; asin?: string }>) => Promise<void>;
}

export function PpcSkuMappingPanel({ skuList, onSave }: PpcSkuMappingPanelProps) {
  const ambiguous = useMemo(
    () => skuList.filter((item) => item.mappingStatus === "AMBIGUOUS"),
    [skuList],
  );
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextChoices: Record<string, string> = {};
    const nextSelected = new Set<string>();
    for (const item of ambiguous) {
      if (item.suggestedProductType) {
        nextChoices[item.sku] = item.suggestedProductType;
        nextSelected.add(item.sku);
      }
    }
    setChoices(nextChoices);
    setSelected(nextSelected);
  }, [ambiguous]);

  if (ambiguous.length === 0) return null;

  const ready = ambiguous.filter((item) => selected.has(item.sku) && choices[item.sku]);
  const save = async () => {
    if (ready.length === 0) return;
    setSaving(true);
    try {
      await onSave(ready.map((item) => ({
        sku: item.sku,
        productType: choices[item.sku],
        asin: item.asin && item.asin !== "B0XXXX" ? item.asin : undefined,
      })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <h3 className="text-sm font-black text-amber-950">{ambiguous.length} SKU cần xác nhận Product Type</h3>
            <p className="mt-0.5 text-[11px] font-medium text-amber-800">
              Các SKU này dùng prefix trùng. Hệ thống không tự gán để tránh áp sai giá vốn.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || ready.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle size={15} weight="bold" />
          {saving ? "Đang lưu..." : `Xác nhận ${ready.length} SKU`}
        </button>
      </div>

      <div className="max-h-80 overflow-auto bg-white">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Prefix</th>
              <th className="px-3 py-2">Product Type</th>
              <th className="px-3 py-2">Gợi ý</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ambiguous.map((item) => {
              const checked = selected.has(item.sku);
              return (
                <tr key={item.sku} className="hover:bg-amber-50/40">
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.sku);
                        else next.delete(item.sku);
                        return next;
                      })}
                      className="rounded border-slate-300 text-amber-700 focus:ring-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2.5 font-bold text-slate-900">{item.sku}</td>
                  <td className="px-3 py-2.5 font-mono font-bold text-amber-800">{item.matchedPrefix || "—"}</td>
                  <td className="px-3 py-2.5">
                    <select
                      value={choices[item.sku] || ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setChoices((current) => ({ ...current, [item.sku]: value }));
                        setSelected((current) => {
                          const next = new Set(current);
                          if (value) next.add(item.sku);
                          else next.delete(item.sku);
                          return next;
                        });
                      }}
                      className="min-w-52 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-800 outline-none focus:border-amber-500"
                    >
                      <option value="">Chọn Product Type...</option>
                      {(item.candidateProductTypes || []).map((candidate) => (
                        <option key={candidate} value={candidate}>{candidate}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-500">
                    {item.suggestedProductType ? (
                      <span><strong className="text-emerald-700">{item.suggestedProductType}</strong>{item.suggestionReason ? ` · ${item.suggestionReason}` : ""}</span>
                    ) : "Chưa đủ tín hiệu — cần chọn một lần"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
