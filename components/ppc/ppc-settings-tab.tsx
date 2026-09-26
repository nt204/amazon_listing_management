"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Tag,
  Sliders,
  ClockCounterClockwise,
  Plus,
  PencilSimple,
  CheckCircle,
  X,
  FileXls,
  ArrowsClockwise,
  Info,
  DownloadSimple,
  UploadSimple,
  Storefront,
  Trash,
  Sparkle,
  Lightning,
  FloppyDisk,
  Copy,
  Gear,
} from "@phosphor-icons/react";
import type {
  ProductCostMaster,
  PpcRuleVersion,
  BulkExport,
} from "@/lib/ppc/sku-architecture-types";
import { getSkuPrefixesForProductType } from "@/lib/ppc/sku-architecture-types";
import { PpcStoreManagerModal } from "./ppc-store-manager-modal";

const parseInputNumber = (val: string | number): number => {
  if (val === undefined || val === null) return 0;
  const cleaned = String(val).replace(",", ".").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const recalculateBreakEvenAcos = (priceStr: string, costStr: string, feeStr: string): string => {
  const p = parseInputNumber(priceStr);
  const c = parseInputNumber(costStr);
  const f = parseInputNumber(feeStr);
  if (p > 0) {
    const profit = p - f - c;
    if (profit > 0) {
      return Number(((profit / p) * 100).toFixed(1)).toString();
    }
    return "0.0";
  }
  return "";
};

interface PpcSettingsTabProps {
  costMasters: ProductCostMaster[];
  ruleVersions: PpcRuleVersion[];
  bulkHistory: BulkExport[];
  initialSubTab?: "phoi" | "rules" | "history";
  onSaveCostMaster: (data: {
    productType: string;
    baseCost: number;
    defaultAmazonFee: number;
    taxRate: number;
    defaultPrice?: number;
    breakEvenAcos?: number;
    effectiveFrom?: string;
    notes?: string;
  }) => Promise<void>;
  onRefreshCostMasters: () => void;
  onRefreshBulkHistory: () => void;
}

function formatAcosTier(tier: PpcRuleVersion["ruleJson"]["hasOrder"][number]): string {
  if (tier.minRef === "break_even_acos_pct") return "> BE ACoS";
  if (tier.maxRef === "min_40_break_even_acos_pct") {
    return `${tier.minAcos}% – min(40%, BE ACoS)`;
  }
  if (tier.maxRef === "break_even_acos_pct") {
    return `> ${tier.minAcos}% – BE ACoS${tier.activeWhen ? " (khi BE > 40%)" : ""}`;
  }
  const left = tier.minInclusive === false ? ">" : "≥";
  const right = tier.maxInclusive === true ? "≤" : "<";
  return `${left} ${tier.minAcos}% và ${right} ${tier.maxAcos}%`;
}

function formatClickTier(tier: PpcRuleVersion["ruleJson"]["noOrder"][number]): string {
  const min = tier.minClicks + (tier.minInclusive === false ? 1 : 0);
  if (tier.maxClicks > 9000) return `Click ≥ ${min}`;
  const max = tier.maxClicks - (tier.maxInclusive === false ? 1 : 0);
  return min === max ? `Click = ${min}` : `Click ${min} – ${max}`;
}

export function PpcSettingsTab({
  costMasters,
  ruleVersions,
  bulkHistory,
  initialSubTab = "phoi",
  onSaveCostMaster,
  onRefreshCostMasters,
  onRefreshBulkHistory,
}: PpcSettingsTabProps) {
  const [subTab, setSubTab] = useState<"phoi" | "rules" | "history">(initialSubTab);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  // Cost Master Drawer state
  const [isPhoiDrawerOpen, setIsPhoiDrawerOpen] = useState(false);
  const [editingPhoi, setEditingPhoi] = useState<ProductCostMaster | null>(null);
  const [formProductType, setFormProductType] = useState("");
  const [formBaseCost, setFormBaseCost] = useState("");
  const [formFee, setFormFee] = useState("");
  const [formTaxRate, setFormTaxRate] = useState("3.0");
  const [formDefaultPrice, setFormDefaultPrice] = useState("25.00");
  const [formBreakEvenAcos, setFormBreakEvenAcos] = useState("45.5");
  const [formEffectiveFrom, setFormEffectiveFrom] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [formNotes, setFormNotes] = useState("");
  const [isSavingPhoi, setIsSavingPhoi] = useState(false);

  // Selected Rule Tab
  const [selectedRuleType, setSelectedRuleType] = useState<"SB01" | "SB05" | "SP03">("SB01");

  // Open Phôi drawer for Add / Edit
  const handleOpenPhoiDrawer = (phoi?: ProductCostMaster) => {
    if (phoi) {
      setEditingPhoi(phoi);
      setFormProductType(phoi.productType);
      setFormBaseCost(phoi.baseCost.toFixed(2));
      setFormFee(phoi.defaultAmazonFee.toFixed(2));
      setFormTaxRate((phoi.taxRate * 100).toFixed(1));
      setFormDefaultPrice(phoi.defaultPrice ? phoi.defaultPrice.toFixed(2) : "0.00");
      setFormBreakEvenAcos(
        phoi.breakEvenAcos
          ? phoi.breakEvenAcos.toFixed(1)
          : recalculateBreakEvenAcos(phoi.defaultPrice.toFixed(2), phoi.baseCost.toFixed(2), phoi.defaultAmazonFee.toFixed(2)) || "45.5"
      );
      setFormEffectiveFrom(new Date().toISOString().split("T")[0]);
      setFormNotes(phoi.notes || "");
    } else {
      setEditingPhoi(null);
      setFormProductType("");
      setFormBaseCost("2.00");
      setFormFee("6.32");
      setFormTaxRate("3.0");
      setFormDefaultPrice("25.00");
      setFormBreakEvenAcos(recalculateBreakEvenAcos("25.00", "2.00", "6.32") || "45.5");
      setFormEffectiveFrom(new Date().toISOString().split("T")[0]);
      setFormNotes("");
    }
    setIsPhoiDrawerOpen(true);
  };

  const handleSavePhoi = async () => {
    if (!formProductType.trim()) {
      alert("Vui lòng nhập tên loại phôi.");
      return;
    }
    try {
      setIsSavingPhoi(true);
      await onSaveCostMaster({
        productType: formProductType.trim(),
        baseCost: parseInputNumber(formBaseCost),
        defaultAmazonFee: parseInputNumber(formFee),
        taxRate: (parseInputNumber(formTaxRate) || 3.0) / 100,
        defaultPrice: parseInputNumber(formDefaultPrice),
        breakEvenAcos: parseInputNumber(formBreakEvenAcos),
        effectiveFrom: formEffectiveFrom,
        notes: formNotes.trim() || undefined,
      });
      setIsPhoiDrawerOpen(false);
    } catch (err) {
      alert("Lỗi khi lưu thông số Phôi: " + String(err));
    } finally {
      setIsSavingPhoi(false);
    }
  };

  // Active Rule for selected tab
  const currentRule = useMemo(() => {
    return ruleVersions.find((r) => r.campaignType === selectedRuleType && r.status === "PUBLISHED")
      || ruleVersions.find((r) => r.campaignType === selectedRuleType)
      || ruleVersions.find((r) => r.status === "PUBLISHED")
      || ruleVersions[0];
  }, [ruleVersions, selectedRuleType]);

  // Handle ESC key to close drawer
  useEffect(() => {
    if (!isPhoiDrawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsPhoiDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPhoiDrawerOpen]);

  return (
    <div className="space-y-6">
      {/* Subtab Navigation */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab("phoi")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
              subTab === "phoi"
                ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80 font-black shadow-2xs"
                : "text-slate-600 font-bold hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Tag size={15} weight={subTab === "phoi" ? "bold" : "regular"} className={subTab === "phoi" ? "text-indigo-600" : "text-slate-400"} />
            <span>1. Quản lý Phôi (Cost Master)</span>
          </button>

          <button
            onClick={() => setSubTab("rules")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
              subTab === "rules"
                ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80 font-black shadow-2xs"
                : "text-slate-600 font-bold hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Sliders size={15} weight={subTab === "rules" ? "bold" : "regular"} className={subTab === "rules" ? "text-indigo-600" : "text-slate-400"} />
            <span>2. Rule PPC (SB01 / SB05 / SP03)</span>
          </button>

        </div>
      </div>

      {/* =========================================================================
          SUBTAB 1: QUẢN LÝ PHÔI (COST MASTER)
         ========================================================================= */}
      {subTab === "phoi" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">QUẢN LÝ PHÔI (COST MASTER)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Lưu trữ giá vốn, phí sàn Amazon, thuế và phiên bản chi phí. SKU sẽ kế thừa các thông số này để tính Profit Before Ads và Break-even ACoS.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleOpenPhoiDrawer()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition shadow-xs cursor-pointer"
              >
                <Plus size={15} weight="bold" />
                + Thêm phôi mới
              </button>
              <button
                onClick={onRefreshCostMasters}
                className="p-2 hover:bg-slate-200 rounded-xl text-slate-500 hover:text-slate-800 transition cursor-pointer"
                title="Tải lại danh sách phôi"
              >
                <ArrowsClockwise size={16} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-bold">
                <tr>
                  <th className="py-3 px-3.5">Product Type</th>
                  <th className="py-3 px-3 text-center">SKU Prefix</th>
                  <th className="py-3 px-3 text-right">Base Cost</th>
                  <th className="py-3 px-3 text-right">Default Price</th>
                  <th className="py-3 px-3 text-right">Profit Before Ads</th>
                  <th className="py-3 px-3 text-right">Break-even ACoS</th>
                  <th className="py-3 px-3 text-right">Min Bid</th>
                  <th className="py-3 px-3 text-right">Max Bid</th>
                  <th className="py-3 px-2.5 text-center">SKUs</th>
                  <th className="py-3 px-2.5 text-center">Version</th>
                  <th className="py-3 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {costMasters.map((phoi) => {
                  const profitBeforeAds = phoi.defaultPrice > 0
                    ? phoi.defaultPrice - phoi.defaultAmazonFee - phoi.baseCost
                    : 0;
                  const breakEvenAcosDisplay = phoi.breakEvenAcos > 0
                    ? `${Math.round(phoi.breakEvenAcos)}%`
                    : (phoi.defaultPrice > 0 ? `${Math.round((profitBeforeAds / phoi.defaultPrice) * 100)}%` : "46%");

                  return (
                    <tr
                      key={phoi.id}
                      onClick={() => handleOpenPhoiDrawer(phoi)}
                      className="hover:bg-indigo-50/30 transition cursor-pointer group"
                    >
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition">
                          {phoi.productType}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {phoi.skuPrefix ? (
                          <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono font-bold text-[11px] border border-indigo-200 tracking-widest">
                            {phoi.skuPrefix}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700 font-medium">
                        ${phoi.baseCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {phoi.defaultPrice > 0 ? `$${phoi.defaultPrice.toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                        {profitBeforeAds > 0 ? `$${profitBeforeAds.toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="inline-block px-2.5 py-0.5 rounded text-xs font-black bg-amber-50 text-amber-800 border border-amber-200">
                          {breakEvenAcosDisplay}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500 font-medium">
                        $0.05
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-indigo-700">
                        {profitBeforeAds > 0 ? `$${(Math.round(0.10 * profitBeforeAds * 100) / 100).toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-2.5 text-center">
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold text-xs border border-indigo-200">
                          {phoi.skuCount || 0}
                        </span>
                      </td>
                      <td className="py-3 px-2.5 text-center">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                          v{phoi.version}.0
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenPhoiDrawer(phoi);
                          }}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition cursor-pointer"
                          title="Tạo phiên bản mới cho phôi"
                        >
                          <PencilSimple size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUBTAB 2: RULE PPC (RULE MANAGER)
         ========================================================================= */}
      {subTab === "rules" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">RULE PPC (SB01 / SB05 / SP COMMON)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Quy tắc tối ưu bid chung theo từng định dạng chiến dịch. Đề xuất sẽ tự động kẹp trong giới hạn trần/sàn tương ứng.
              </p>
            </div>

            {/* Campaign Type Pills */}
            <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
              {(["SB01", "SB05", "SP03"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedRuleType(type)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    selectedRuleType === type
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  [{type}]
                </button>
              ))}
            </div>
          </div>

          {currentRule && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* HAS ORDER TABLE */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h4 className="text-xs font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span>KHI CÓ ĐƠN (HAS ORDER)</span>
                  </h4>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {currentRule.version} {currentRule.status}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500 border-b border-slate-200 font-bold bg-slate-50/50">
                      <tr>
                        <th className="py-2.5 px-3">Khoảng ACoS</th>
                        <th className="py-2.5 px-3">Hành động</th>
                        <th className="py-2.5 px-3">Công thức</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {currentRule.ruleJson.hasOrder.map((tier, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 text-slate-700 font-semibold">
                            {formatAcosTier(tier)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`font-black ${
                                tier.action === "BID_INCREASE"
                                  ? "text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded"
                                  : tier.action === "BID_DECREASE"
                                  ? "text-rose-600 bg-rose-50 px-2 py-0.5 rounded"
                                  : "text-slate-600 bg-slate-100 px-2 py-0.5 rounded"
                              }`}
                            >
                              {tier.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-800 font-sans font-medium">
                            {tier.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* NO ORDER TABLE */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h4 className="text-xs font-black text-rose-700 uppercase tracking-wider">
                    KHI KHÔNG CÓ ĐƠN (NO ORDER)
                  </h4>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500 border-b border-slate-200 font-bold bg-slate-50/50">
                      <tr>
                        <th className="py-2.5 px-3">Lượt Clicks</th>
                        <th className="py-2.5 px-3">Hành động</th>
                        <th className="py-2.5 px-3">Công thức</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {currentRule.ruleJson.noOrder.map((tier, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 text-slate-700 font-semibold">
                            {formatClickTier(tier)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`font-black ${
                                tier.action === "BID_INCREASE"
                                  ? "text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded"
                                  : tier.action === "PAUSE_TARGET"
                                  ? "text-amber-700 bg-amber-50 px-2 py-0.5 rounded"
                                  : tier.action === "BID_DECREASE"
                                  ? "text-rose-600 bg-rose-50 px-2 py-0.5 rounded"
                                  : "text-slate-600 bg-slate-100 px-2 py-0.5 rounded"
                              }`}
                            >
                              {tier.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-800 font-sans font-medium">
                            {tier.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          SUBTAB 3: LỊCH SỬ XUẤT BULK (BULK EXPORT HISTORY)
         ========================================================================= */}
      {subTab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">LỊCH SỬ XUẤT BULK FILE</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhật ký các tệp Amazon Advertising Bulksheet đã được xuất từ Action Queue để upload lên Amazon Ads Console.
              </p>
            </div>
            <button
              onClick={onRefreshBulkHistory}
              className="p-2 hover:bg-slate-200 rounded-xl text-slate-500 hover:text-slate-800 transition cursor-pointer"
              title="Tải lại lịch sử"
            >
              <ArrowsClockwise size={16} />
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-bold">
                <tr>
                  <th className="py-3 px-4">Tên Tệp</th>
                  <th className="py-3 px-4 text-center">Số Lượng Action</th>
                  <th className="py-3 px-4">Phân loại hành động</th>
                  <th className="py-3 px-4 text-center">Ngày tạo</th>
                  <th className="py-3 px-4 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {bulkHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      Chưa có lịch sử xuất file nào.
                    </td>
                  </tr>
                ) : (
                  bulkHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-indigo-50/20 transition">
                      <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                        <FileXls size={18} className="text-emerald-600 shrink-0" weight="fill" />
                        {item.storeName && (
                          <span className="shrink-0 px-1.5 py-0.2 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-bold uppercase">
                            {item.storeName}
                          </span>
                        )}
                        <span>{item.fileName}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold text-xs border border-indigo-200">
                          {item.actionCount}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs space-x-2">
                        <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                          Update Bid: {item.summary.updateBidCount || 0}
                        </span>
                        <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                          Pause: {item.summary.pauseCount || 0}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">
                        {new Date(item.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DRAWER PHÔI (COST MASTER DRAWER) */}
      {isPhoiDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs transition"
          onClick={() => setIsPhoiDrawerOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white border-l border-slate-200 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6">
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-black text-slate-900">
                    {editingPhoi ? `PHÔI: ${editingPhoi.productType.toUpperCase()}` : "THÊM PHÔI MỚI"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {editingPhoi
                      ? `Lưu phiên bản mới (v${editingPhoi.version + 1}.0). Không ghi đè lịch sử.`
                      : "Định nghĩa phôi sản phẩm để kế thừa sang các SKU."}
                  </p>
                </div>
                <button
                  onClick={() => setIsPhoiDrawerOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Tên Loại Phôi:</label>
                  <input
                    type="text"
                    value={formProductType}
                    onChange={(e) => setFormProductType(e.target.value)}
                    placeholder="e.g. Ornament, Bullet Tumbler, Blanket..."
                    disabled={!!editingPhoi}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white disabled:opacity-50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Base Cost ($ Giá vốn):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formBaseCost}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormBaseCost(val);
                        const autoAcos = recalculateBreakEvenAcos(formDefaultPrice, val, formFee);
                        if (autoAcos !== "") setFormBreakEvenAcos(autoAcos);
                      }}
                      placeholder="2.00"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Default Amz Fee ($ Phí sàn):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formFee}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormFee(val);
                        const autoAcos = recalculateBreakEvenAcos(formDefaultPrice, formBaseCost, val);
                        if (autoAcos !== "") setFormBreakEvenAcos(autoAcos);
                      }}
                      placeholder="6.32"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Default Price ($ Giá bán):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formDefaultPrice}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormDefaultPrice(val);
                        const autoAcos = recalculateBreakEvenAcos(val, formBaseCost, formFee);
                        if (autoAcos !== "") setFormBreakEvenAcos(autoAcos);
                      }}
                      placeholder="25.00"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-700 font-bold">ACoS Hòa Vốn (%):</label>
                      <span
                        className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-bold"
                        title="Tự động tính theo: (Price - Fee - Cost) / Price"
                      >
                        Tự tính
                      </span>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formBreakEvenAcos}
                      onChange={(e) => setFormBreakEvenAcos(e.target.value)}
                      placeholder="46"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>
                </div>

                {parseInputNumber(formDefaultPrice) > 0 && (
                  <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-emerald-900">Profit Before Ads: </span>
                        <span className="text-emerald-700 text-[11px]">(Price - Fee - Cost)</span>
                      </div>
                      <span className="font-mono font-black text-emerald-800 text-sm">
                        ${Math.max(0, parseInputNumber(formDefaultPrice) - parseInputNumber(formFee) - parseInputNumber(formBaseCost)).toFixed(2)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-[11px]">
                      <div className="text-slate-600">
                        <span>Min Bid: </span>
                        <strong className="font-mono text-slate-800">$0.05</strong>
                      </div>
                      <div className="text-indigo-900">
                        <span>Max Bid (CR 10%): </span>
                        <strong className="font-mono font-bold text-indigo-700 text-xs">
                          ${(Math.max(0, parseInputNumber(formDefaultPrice) - parseInputNumber(formFee) - parseInputNumber(formBaseCost)) * 0.10).toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Tax Rate (% Thuế):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formTaxRate}
                      onChange={(e) => setFormTaxRate(e.target.value)}
                      placeholder="3.0"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Effective From (Áp dụng):</label>
                    <input
                      type="date"
                      value={formEffectiveFrom}
                      onChange={(e) => setFormEffectiveFrom(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Ghi chú (Notes):</label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Ghi chú về lô phôi hoặc thay đổi biểu phí..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setIsPhoiDrawerOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleSavePhoi}
                disabled={isSavingPhoi}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle size={16} weight="bold" />
                {isSavingPhoi ? "Đang lưu..." : "Save New Version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Trang độc lập: QUẢN LÝ PHÔI (COST MASTER)
 * Dành riêng cho mục Quản lý Phôi trên Sidebar PPC Analytics
 */
export function PpcCostMasterStandalone() {
  const [costMasters, setCostMasters] = useState<ProductCostMaster[]>([]);
  const [stores, setStores] = useState<Array<{ id: string; name: string; marketplace?: string }>>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Drawer Edit / Add state
  const [isPhoiDrawerOpen, setIsPhoiDrawerOpen] = useState(false);
  const [editingPhoi, setEditingPhoi] = useState<ProductCostMaster | null>(null);
  const [formProductType, setFormProductType] = useState("");
  const [formBaseCost, setFormBaseCost] = useState("");
  const [formFee, setFormFee] = useState("");
  const [formTaxRate, setFormTaxRate] = useState("3.0");
  const [formDefaultPrice, setFormDefaultPrice] = useState("25.00");
  const [formBreakEvenAcos, setFormBreakEvenAcos] = useState("45.5");
  const [formEffectiveFrom, setFormEffectiveFrom] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [formNotes, setFormNotes] = useState("");
  const [isSavingPhoi, setIsSavingPhoi] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Convenient Fast Entry Inline State
  const [isFastEntryOpen, setIsFastEntryOpen] = useState(false);
  const [fastProductType, setFastProductType] = useState("");
  const [fastSkuPrefix, setFastSkuPrefix] = useState("");
  const [fastBaseCost, setFastBaseCost] = useState("");
  const [fastFee, setFastFee] = useState("");
  const [fastPrice, setFastPrice] = useState("");
  const [fastTaxRate, setFastTaxRate] = useState("");
  const [fastNotes, setFastNotes] = useState("");
  const [isSavingFast, setIsSavingFast] = useState(false);

  // Store Manager Modal
  const [isStoreManagerOpen, setIsStoreManagerOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [deletingPhoiId, setDeletingPhoiId] = useState<string | null>(null);

  const loadCostMasters = async (storeId?: string) => {
    try {
      setLoading(true);
      const targetStore = storeId !== undefined ? storeId : selectedStoreId;
      const url = targetStore
        ? `/api/ppc/cost-master?storeId=${encodeURIComponent(targetStore)}`
        : "/api/ppc/cost-master";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        if (d?.data) {
          setCostMasters(d.data);
          // Tự động mở khung nhập nhanh nếu store này chưa có dòng phôi nào
          if (d.data.length === 0) {
            setIsFastEntryOpen(true);
          }
        }
        if (d?.stores) setStores(d.stores);
        if (d?.activeStoreId && (!selectedStoreId || storeId !== undefined)) {
          setSelectedStoreId(d.activeStoreId);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCostMasters();
  }, []);

  const handleStoreChange = (newStoreId: string) => {
    setSelectedStoreId(newStoreId);
    void loadCostMasters(newStoreId);
  };

  // Handle ESC key to close drawer
  useEffect(() => {
    if (!isPhoiDrawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsPhoiDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPhoiDrawerOpen]);

  const handleOpenPhoiDrawer = (phoi?: ProductCostMaster) => {
    if (phoi) {
      setEditingPhoi(phoi);
      setFormProductType(phoi.productType);
      setFormBaseCost(phoi.baseCost.toFixed(2));
      setFormFee(phoi.defaultAmazonFee.toFixed(2));
      setFormTaxRate((phoi.taxRate * 100).toFixed(1));
      setFormDefaultPrice(phoi.defaultPrice ? phoi.defaultPrice.toFixed(2) : "0.00");
      setFormBreakEvenAcos(phoi.breakEvenAcos ? phoi.breakEvenAcos.toFixed(1) : "45.5");
      setFormEffectiveFrom(new Date().toISOString().split("T")[0]);
      setFormNotes(phoi.notes || "");
    } else {
      setEditingPhoi(null);
      setFormProductType("");
      setFormBaseCost("2.00");
      setFormFee("6.32");
      setFormTaxRate("3.0");
      setFormDefaultPrice("25.00");
      setFormBreakEvenAcos("45.5");
      setFormEffectiveFrom(new Date().toISOString().split("T")[0]);
      setFormNotes("");
    }
    setIsPhoiDrawerOpen(true);
  };

  const handleSavePhoi = async () => {
    if (!formProductType.trim()) {
      alert("Vui lòng nhập tên loại phôi.");
      return;
    }
    try {
      setIsSavingPhoi(true);
      const res = await fetch("/api/ppc/cost-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId || undefined,
          productType: formProductType.trim(),
          baseCost: parseInputNumber(formBaseCost),
          defaultAmazonFee: parseInputNumber(formFee),
          taxRate: (parseInputNumber(formTaxRate) || 3.0) / 100,
          defaultPrice: parseInputNumber(formDefaultPrice),
          breakEvenAcos: parseInputNumber(formBreakEvenAcos),
          effectiveFrom: formEffectiveFrom,
          notes: formNotes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Không thể lưu thông số Phôi.");
      await loadCostMasters(selectedStoreId);
      setIsPhoiDrawerOpen(false);
    } catch (err) {
      alert("Lỗi khi lưu thông số Phôi: " + String(err));
    } finally {
      setIsSavingPhoi(false);
    }
  };

  // Tính Break-even ACoS thời gian thực cho Fast Entry
  const fastP = parseInputNumber(fastPrice);
  const fastC = parseInputNumber(fastBaseCost);
  const fastF = parseInputNumber(fastFee);
  const fastT = (parseInputNumber(fastTaxRate) || 3.0) / 100;
  const fastProfit = fastP > 0 ? fastP - fastF - fastC - (fastP * fastT) : 0;
  const fastCalculatedBeAcos = (fastP > 0 && fastProfit > 0)
    ? Number(((fastProfit / fastP) * 100).toFixed(1))
    : 0;

  // Lưu nhanh phôi trực tiếp từ inline form
  const handleFastAddPhoi = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedType = fastProductType.trim();
    if (!trimmedType) {
      alert("Vui lòng nhập tên loại phôi (Ví dụ: Ornament 2D, Tumbler 20oz...)");
      return;
    }

    try {
      setIsSavingFast(true);
      const res = await fetch("/api/ppc/cost-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId || undefined,
          productType: trimmedType,
          skuPrefix: fastSkuPrefix.trim() || undefined,
          baseCost: fastC,
          defaultAmazonFee: fastF,
          taxRate: fastT,
          defaultPrice: fastP,
          breakEvenAcos: fastCalculatedBeAcos,
          notes: fastNotes.trim() || undefined,
        }),
      });

      if (!res.ok) throw new Error("Không thể lưu phôi.");
      await loadCostMasters(selectedStoreId);
      // Chỉ xóa tên phôi & sku prefix, giữ lại giá/phí để gõ tiếp phôi kế tiếp nhanh
      setFastProductType("");
      setFastSkuPrefix("");
      setFastNotes("");
    } catch (err: any) {
      alert(err.message || "Lỗi khi lưu phôi.");
    } finally {
      setIsSavingFast(false);
    }
  };

  // Xóa một dòng phôi
  const handleDeletePhoi = async (phoi: ProductCostMaster) => {
    if (!window.confirm(`Xác nhận xóa phôi "${phoi.productType}" khỏi store?`)) return;

    try {
      setDeletingPhoiId(phoi.id);
      const res = await fetch(`/api/ppc/cost-master?id=${encodeURIComponent(phoi.id)}&storeId=${encodeURIComponent(selectedStoreId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Không thể xóa dòng phôi.");
      await loadCostMasters(selectedStoreId);
    } catch (err: any) {
      alert(err.message || "Lỗi khi xóa dòng phôi.");
    } finally {
      setDeletingPhoiId(null);
    }
  };

  // Sao chép danh mục phôi từ HSOSTORE
  const handleCloneFromHso = async () => {
    if (!currentStore) return;
    const confirmMsg = `Bạn có chắc chắn muốn sao chép toàn bộ danh mục phôi từ HSOSTORE sang store "${currentStore.name}" không?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setIsCloning(true);
      const res = await fetch("/api/ppc/cost-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clone",
          sourceStore: "HSOSTORE",
          targetStore: currentStore.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Không thể sao chép phôi.");
      alert(data.message || "Đã sao chép phôi thành công!");
      await loadCostMasters(selectedStoreId);
    } catch (err: any) {
      alert(err.message || "Lỗi khi sao chép phôi.");
    } finally {
      setIsCloning(false);
    }
  };

  const handleExportExcel = () => {
    const q = selectedStoreId ? `?export=excel&storeId=${encodeURIComponent(selectedStoreId)}` : "?export=excel";
    window.open(`/api/ppc/cost-master${q}`, "_blank");
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsImporting(true);
      const formData = new FormData();
      formData.append("file", file);
      if (selectedStoreId) {
        formData.append("storeId", selectedStoreId);
      }
      const res = await fetch("/api/ppc/cost-master/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Lỗi khi import file Excel.");
      alert(data.message || `Đã import thành công ${data.importedCount} loại phôi!`);
      await loadCostMasters(selectedStoreId);
    } catch (err) {
      alert("Lỗi khi import file Excel: " + String(err));
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const currentStore = useMemo(() => {
    return stores.find((s) => s.id === selectedStoreId) || stores[0] || null;
  }, [stores, selectedStoreId]);

  const filteredMasters = useMemo(() => {
    if (!searchQuery.trim()) return costMasters;
    const q = searchQuery.toLowerCase();
    return costMasters.filter((p) => p.productType.toLowerCase().includes(q));
  }, [costMasters, searchQuery]);

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-2xs">
            <Tag size={22} weight="duotone" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-black text-slate-900 tracking-tight">QUẢN LÝ PHÔI (COST MASTER)</h2>
              
              {/* Store Selector Dropdown */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200/70 border border-slate-300 text-slate-800 text-xs font-bold transition shadow-2xs">
                <Storefront size={15} weight="duotone" className="text-indigo-600 shrink-0" />
                <span className="text-slate-500 font-medium">Store:</span>
                <select
                  value={selectedStoreId}
                  onChange={(e) => handleStoreChange(e.target.value)}
                  className="bg-transparent font-bold text-indigo-900 border-none outline-none cursor-pointer text-xs"
                >
                  {stores.length === 0 && (
                    <option value="">Đang tải store...</option>
                  )}
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.marketplace || "US"})
                    </option>
                  ))}
                </select>
              </div>

              {/* Nút Quản Lý Store */}
              <button
                type="button"
                onClick={() => setIsStoreManagerOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer"
                title="Quản lý thêm, sửa, xóa danh sách store"
              >
                <Gear size={13} weight="bold" className="text-slate-500" />
                <span>Quản Lý Store</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Quản lý giá vốn gốc, phí sàn Amazon, thuế, giá bán và ACoS hòa vốn theo từng store.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end lg:self-auto flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportFile}
            className="hidden"
          />

          {/* Tải File Mẫu Excel */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition shadow-2xs cursor-pointer"
            title="Tải file mẫu Excel (.xlsx) chuẩn để điền và import"
          >
            <DownloadSimple size={15} weight="bold" />
            <span>Tải Mẫu / Xuất Excel</span>
          </button>

          {/* Import File Excel */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-bold transition shadow-2xs cursor-pointer disabled:opacity-50"
            title="Nhập bảng Phôi từ file Excel (.xlsx)"
          >
            <UploadSimple size={15} weight="bold" />
            <span>{isImporting ? "Đang import..." : "Import Excel"}</span>
          </button>

          {/* Nút bật/tắt Nhập Nhanh */}
          <button
            type="button"
            onClick={() => setIsFastEntryOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer ${
              isFastEntryOpen
                ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                : "bg-indigo-600 hover:bg-indigo-700 text-white"
            }`}
          >
            <Lightning size={15} weight="fill" className={isFastEntryOpen ? "text-indigo-600" : "text-amber-300"} />
            <span>{isFastEntryOpen ? "Đóng Nhập Nhanh" : "+ Điền Phôi Nhanh"}</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => void loadCostMasters()}
            disabled={loading}
            className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 hover:text-slate-900 transition cursor-pointer disabled:opacity-50"
            title="Tải lại danh sách"
          >
            <ArrowsClockwise size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Helper Banner khi Store là Bảng Trắng (Chưa có phôi) */}
      {!loading && costMasters.length === 0 && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-50/80 to-indigo-50/60 border border-amber-200/80 shadow-xs space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500 text-white shadow-xs shrink-0">
              <Sparkle size={20} weight="fill" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-black text-slate-900">
                Store "{currentStore?.name || "này"}" hiện là bảng phôi trắng
              </h3>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Hệ thống hỗ trợ 3 cách điền phôi nhanh chóng và thuận tiện nhất để bạn lựa chọn:
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {/* Cách 1: Nhập dòng nhanh */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs text-indigo-700">
                <Lightning size={16} weight="fill" className="text-amber-500" />
                <span>1. Nhập Dòng Trực Tiếp</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Gõ tên phôi, giá bán, giá vốn vào form nhập nhanh bên dưới. Hệ thống tự động tính Break-even ACoS ngay khi gõ.
              </p>
              <button
                type="button"
                onClick={() => setIsFastEntryOpen(true)}
                className="w-full py-1.5 px-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs transition cursor-pointer"
              >
                Mở Form Nhập Nhanh
              </button>
            </div>

            {/* Cách 2: Tải mẫu Excel & Nhập */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs text-sky-700">
                <FileXls size={16} weight="duotone" className="text-emerald-600" />
                <span>2. Điền File Excel Mẫu</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Tải file mẫu định dạng sẵn với 2 dòng ví dụ minh họa, chỉnh sửa trên máy tính rồi upload lên lại.
              </p>
              <button
                type="button"
                onClick={handleExportExcel}
                className="w-full py-1.5 px-3 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold text-xs transition cursor-pointer"
              >
                Tải File Mẫu (.xlsx)
              </button>
            </div>

            {/* Cách 3: Sao chép từ HSOSTORE */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs text-purple-700">
                <Copy size={16} weight="duotone" className="text-purple-600" />
                <span>3. Sao Chép Từ HSOSTORE</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Nếu store này bán các sản phẩm tương tự HSOSTORE, sao chép toàn bộ sang chỉ với 1 click để đỡ tốn công gõ lại.
              </p>
              <button
                type="button"
                onClick={handleCloneFromHso}
                disabled={isCloning || currentStore?.name === "HSOSTORE"}
                className="w-full py-1.5 px-3 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                {isCloning ? "Đang sao chép..." : "Sao Chép Phôi HSOSTORE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Khung Nhập Nhanh Trực Tiếp (Inline Fast Entry Card) */}
      {isFastEntryOpen && (
        <form
          onSubmit={handleFastAddPhoi}
          className="p-4 rounded-2xl bg-indigo-50/70 border-2 border-indigo-300/80 shadow-xs space-y-3 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-black text-indigo-950">
              <Lightning size={16} weight="fill" className="text-amber-500" />
              <span>NHẬP PHÔI NHANH • STORE {currentStore?.name || "HSOSTORE"}</span>
              <span className="text-slate-400 font-normal text-[11px]">(Tự động tính Break-even ACoS real-time)</span>
            </div>
            <button
              type="button"
              onClick={() => setIsFastEntryOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {/* Product Type */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Product Type <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Ornament 2D, Tumbler 20oz..."
                value={fastProductType}
                onChange={(e) => setFastProductType(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 focus:border-indigo-600 rounded-lg font-bold text-slate-900 text-xs shadow-2xs outline-none"
              />
            </div>

            {/* SKU Prefix */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                SKU Prefix
              </label>
              <input
                type="text"
                placeholder="ORN, TUM, MUG..."
                value={fastSkuPrefix}
                onChange={(e) => setFastSkuPrefix(e.target.value.toUpperCase())}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 focus:border-indigo-600 rounded-lg font-bold text-slate-900 text-xs shadow-2xs outline-none font-mono tracking-widest uppercase"
              />
            </div>

            {/* Base Cost */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Base Cost ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="2.00"
                value={fastBaseCost}
                onChange={(e) => setFastBaseCost(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 focus:border-indigo-600 rounded-lg font-bold text-slate-900 text-xs shadow-2xs outline-none"
              />
            </div>

            {/* Default Price */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Default Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="24.99"
                value={fastPrice}
                onChange={(e) => setFastPrice(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 focus:border-indigo-600 rounded-lg font-bold text-slate-900 text-xs shadow-2xs outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-indigo-200/60 text-xs">
            {/* Real-time calculated indicators */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-600">
                Lãi trước ads: <strong className="text-emerald-700 font-mono">${fastProfit > 0 ? fastProfit.toFixed(2) : "0.00"}</strong>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-black text-xs border border-amber-300 shadow-2xs">
                Break-even ACoS: {fastCalculatedBeAcos}%
              </span>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSavingFast}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              <FloppyDisk size={15} weight="bold" />
              <span>{isSavingFast ? "Đang lưu..." : "Lưu Dòng Nhanh"}</span>
            </button>
          </div>
        </form>
      )}

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên phôi..."
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white focus:border-indigo-600"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-500">
              Tổng cộng: <strong className="text-slate-900 font-bold">{filteredMasters.length}</strong> loại phôi
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-extrabold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-3.5">Product Type</th>
                <th className="py-3 px-3 text-right">Base Cost</th>
                <th className="py-3 px-3 text-right">Default Amazon Fee</th>
                <th className="py-3 px-3 text-right">Default Price</th>
                <th className="py-3 px-3 text-right">Profit Before Ads</th>
                <th className="py-3 px-3 text-right">Break-even ACoS</th>
                <th className="py-3 px-3 text-right">Min Bid</th>
                <th className="py-3 px-3 text-right">Max Bid</th>
                <th className="py-3 px-2.5 text-center">SKU Sử Dụng</th>
                <th className="py-3 px-2.5 text-center">Phiên bản</th>
                <th className="py-3 px-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    Đang tải dữ liệu phôi...
                  </td>
                </tr>
              ) : filteredMasters.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    Chưa có phôi nào được thiết lập cho store này.
                  </td>
                </tr>
              ) : (
                filteredMasters.map((phoi) => {
                  const profitBeforeAds = phoi.defaultPrice > 0
                    ? phoi.defaultPrice - phoi.defaultAmazonFee - phoi.baseCost
                    : 0;
                  const breakEvenAcosDisplay = phoi.breakEvenAcos > 0
                    ? `${Math.round(phoi.breakEvenAcos)}%`
                    : (phoi.defaultPrice > 0 ? `${Math.round((profitBeforeAds / phoi.defaultPrice) * 100)}%` : "46%");
                  const isDeleting = deletingPhoiId === phoi.id;

                  return (
                    <tr
                      key={phoi.id}
                      onClick={() => handleOpenPhoiDrawer(phoi)}
                      className="hover:bg-indigo-50/30 transition cursor-pointer group"
                    >
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition">
                          {phoi.productType}
                        </div>
                        {getSkuPrefixesForProductType(phoi.productType).length > 0 && (
                          <div className="mt-0.5 font-mono text-[10px] font-semibold text-slate-400">
                            {getSkuPrefixesForProductType(phoi.productType).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700 font-medium">
                        ${phoi.baseCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700 font-medium">
                        ${phoi.defaultAmazonFee.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {phoi.defaultPrice > 0 ? `$${phoi.defaultPrice.toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                        {phoi.defaultPrice > 0 ? `$${profitBeforeAds.toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="inline-block px-2.5 py-0.5 rounded text-xs font-black bg-amber-50 text-amber-800 border border-amber-200">
                          {breakEvenAcosDisplay}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-500 font-medium">
                        $0.05
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-indigo-700">
                        {profitBeforeAds > 0 ? `$${(Math.round(0.10 * profitBeforeAds * 100) / 100).toFixed(2)}` : "-"}
                      </td>
                      <td className="py-3 px-2.5 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold text-xs border border-indigo-200">
                          {phoi.skuCount || 0}
                        </span>
                      </td>
                      <td className="py-3 px-2.5 text-center">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                          v{phoi.version}.0
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenPhoiDrawer(phoi);
                            }}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition cursor-pointer"
                            title="Tạo phiên bản mới cho phôi"
                          >
                            <PencilSimple size={15} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeletePhoi(phoi);
                            }}
                            disabled={isDeleting}
                            className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition cursor-pointer"
                            title="Xóa phôi này"
                          >
                            <Trash size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Quản Lý Danh Sách Store */}
      <PpcStoreManagerModal
        isOpen={isStoreManagerOpen}
        onClose={() => setIsStoreManagerOpen(false)}
        onStoreSelected={(name) => {
          const matched = stores.find((s) => s.name === name);
          if (matched) handleStoreChange(matched.id);
        }}
        onNavigateToCostMaster={(name) => {
          const matched = stores.find((s) => s.name === name);
          if (matched) handleStoreChange(matched.id);
        }}
      />

      {/* Drawer: Add / Edit Phôi */}
      {isPhoiDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs transition"
          onClick={() => setIsPhoiDrawerOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white border-l border-slate-200 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-700">
                    <Tag size={18} weight="bold" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase">
                      {editingPhoi ? `Tạo Phiên Bản Mới: ${editingPhoi.productType}` : "Thêm Phôi Mới"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {editingPhoi
                        ? `Phiên bản v${editingPhoi.version}.0 • Store: ${currentStore?.name || "HSOSTORE"}`
                        : `Áp dụng cho store: ${currentStore?.name || "HSOSTORE"}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsPhoiDrawerOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Tên Loại Phôi:</label>
                  <input
                    type="text"
                    value={formProductType}
                    onChange={(e) => setFormProductType(e.target.value)}
                    placeholder="e.g. Ornament, Bullet Tumbler, Blanket..."
                    disabled={!!editingPhoi}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white disabled:opacity-50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Base Cost ($ Giá vốn):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formBaseCost}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormBaseCost(val);
                        const autoAcos = recalculateBreakEvenAcos(formDefaultPrice, val, formFee);
                        if (autoAcos !== "") setFormBreakEvenAcos(autoAcos);
                      }}
                      placeholder="2.00"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Default Amz Fee ($ Phí sàn):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formFee}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormFee(val);
                        const autoAcos = recalculateBreakEvenAcos(formDefaultPrice, formBaseCost, val);
                        if (autoAcos !== "") setFormBreakEvenAcos(autoAcos);
                      }}
                      placeholder="6.32"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Default Price ($ Giá bán):</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formDefaultPrice}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormDefaultPrice(val);
                        const autoAcos = recalculateBreakEvenAcos(val, formBaseCost, formFee);
                        if (autoAcos !== "") setFormBreakEvenAcos(autoAcos);
                      }}
                      placeholder="25.00"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-700 font-bold">ACoS Hòa Vốn (%):</label>
                      <span
                        className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-bold"
                        title="Tự động tính theo: (Price - Fee - Cost) / Price"
                      >
                        Tự tính
                      </span>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formBreakEvenAcos}
                      onChange={(e) => setFormBreakEvenAcos(e.target.value)}
                      placeholder="46"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>
                </div>

                {parseInputNumber(formDefaultPrice) > 0 && (
                  <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-emerald-900">Profit Before Ads: </span>
                        <span className="text-emerald-700 text-[11px]">(Price - Fee - Cost)</span>
                      </div>
                      <span className="font-mono font-black text-emerald-800 text-sm">
                        ${Math.max(0, parseInputNumber(formDefaultPrice) - parseInputNumber(formFee) - parseInputNumber(formBaseCost)).toFixed(2)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-[11px]">
                      <div className="text-slate-600">
                        <span>Min Bid: </span>
                        <strong className="font-mono text-slate-800">$0.05</strong>
                      </div>
                      <div className="text-indigo-900">
                        <span>Max Bid (CR 10%): </span>
                        <strong className="font-mono font-bold text-indigo-700 text-xs">
                          ${(Math.max(0, parseInputNumber(formDefaultPrice) - parseInputNumber(formFee) - parseInputNumber(formBaseCost)) * 0.10).toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Tax Rate (% Thuế):</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formTaxRate}
                      onChange={(e) => setFormTaxRate(e.target.value)}
                      placeholder="3.0"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Effective From (Áp dụng):</label>
                    <input
                      type="date"
                      value={formEffectiveFrom}
                      onChange={(e) => setFormEffectiveFrom(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono focus:outline-none focus:border-indigo-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Ghi chú (Notes):</label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Ghi chú về lô phôi hoặc thay đổi biểu phí..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setIsPhoiDrawerOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleSavePhoi}
                disabled={isSavingPhoi}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle size={16} weight="bold" />
                {isSavingPhoi ? "Đang lưu..." : "Save New Version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Trang độc lập: QUẢN LÝ RULE PPC
 * Dành riêng cho mục Quản lý Rule trên Sidebar PPC Analytics
 */
export function PpcRuleManagerStandalone() {
  const [ruleVersions, setRuleVersions] = useState<PpcRuleVersion[]>([]);
  const [bulkHistory, setBulkHistory] = useState<BulkExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");
  const [selectedRuleType, setSelectedRuleType] = useState<"SB01" | "SB05" | "SP03">("SB01");
  const ruleFileInputRef = useRef<HTMLInputElement>(null);
  const [importingRule, setImportingRule] = useState(false);

  const handleExportRule = () => {
    window.location.href = "/api/ppc/rules?download=1";
  };

  const handleImportRule = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setImportingRule(true);
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/ppc/rules", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || payload?.message || "Import rule thất bại.");
      if (payload?.data) setRuleVersions(payload.data);
      alert("Đã kiểm tra và áp dụng rule PPC mới.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Import rule thất bại.");
    } finally {
      setImportingRule(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [resRules, resHistory] = await Promise.all([
        fetch("/api/ppc/rules", { cache: "no-store" }),
        fetch("/api/ppc/bulk-export", { cache: "no-store" }),
      ]);
      if (resRules.ok) {
        const d = await resRules.json();
        if (d?.data) setRuleVersions(d.data);
      }
      if (resHistory.ok) {
        const d = await resHistory.json();
        if (d?.data) setBulkHistory(d.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const currentRule = useMemo(() => {
    return ruleVersions.find((r) => r.campaignType === selectedRuleType && r.status === "PUBLISHED")
      || ruleVersions.find((r) => r.campaignType === selectedRuleType)
      || ruleVersions.find((r) => r.status === "PUBLISHED")
      || ruleVersions[0];
  }, [ruleVersions, selectedRuleType]);

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-2xs">
            <Sliders size={22} weight="duotone" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">CẤU HÌNH RULE PPC & BULK AUDIT</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Quy tắc tối ưu tự động cho Sponsored Brands (SB01, SB05) và Sponsored Products (SP01, SP03, SP04) theo Break-even ACoS và Max Bid.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={ruleFileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportRule}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleExportRule}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition cursor-pointer"
          >
            <DownloadSimple size={15} weight="bold" />
            Xuất Rule
          </button>
          <button
            type="button"
            onClick={() => ruleFileInputRef.current?.click()}
            disabled={importingRule}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <UploadSimple size={15} weight="bold" />
            {importingRule ? "Đang đọc..." : "Nhập Rule"}
          </button>
          {/* Subtab Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setActiveTab("rules")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                activeTab === "rules"
                  ? "bg-white text-indigo-700 font-extrabold shadow-2xs"
                  : "text-slate-600 font-bold hover:text-slate-900"
              }`}
            >
              <Sliders size={14} weight={activeTab === "rules" ? "bold" : "regular"} />
              <span>Rule PPC</span>
            </button>
          </div>

          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 hover:text-slate-900 transition cursor-pointer disabled:opacity-50"
            title="Tải lại dữ liệu"
          >
            <ArrowsClockwise size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "rules" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
            <div>
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                ĐỊNH DẠNG CHIẾN DỊCH (CAMPAIGN TYPE)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Chọn format để xem chi tiết ma trận tối ưu bid có đơn và không có đơn.
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200 shadow-2xs">
              {(["SB01", "SB05", "SP03"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedRuleType(type)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    selectedRuleType === type
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                  }`}
                >
                  [{type}]
                </button>
              ))}
            </div>
          </div>

          {currentRule && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* HAS ORDER TABLE */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h4 className="text-xs font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span>KHI CÓ ĐƠN (HAS ORDER)</span>
                    </h4>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {currentRule.version} {currentRule.status}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500 border-b border-slate-200 font-bold bg-slate-50/50 text-[11px]">
                        <tr>
                          <th className="py-2.5 px-3">Khoảng ACoS</th>
                          <th className="py-2.5 px-3">Hành động</th>
                          <th className="py-2.5 px-3">Công thức</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {currentRule.ruleJson.hasOrder.map((tier, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 text-slate-700 font-semibold">
                              {formatAcosTier(tier)}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`font-black ${
                                  tier.action === "BID_INCREASE"
                                    ? "text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded"
                                    : tier.action === "BID_DECREASE"
                                    ? "text-rose-600 bg-rose-50 px-2 py-0.5 rounded"
                                    : "text-slate-600 bg-slate-100 px-2 py-0.5 rounded"
                                }`}
                              >
                                {tier.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-800 font-sans font-medium">
                              {tier.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* NO ORDER TABLE */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h4 className="text-xs font-black text-rose-700 uppercase tracking-wider">
                      KHI KHÔNG CÓ ĐƠN (NO ORDER)
                    </h4>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500 border-b border-slate-200 font-bold bg-slate-50/50 text-[11px]">
                        <tr>
                          <th className="py-2.5 px-3">Lượt Clicks</th>
                          <th className="py-2.5 px-3">Hành động</th>
                          <th className="py-2.5 px-3">Công thức</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {currentRule.ruleJson.noOrder.map((tier, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 text-slate-700 font-semibold">
                              {formatClickTier(tier)}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`font-black ${
                                  tier.action === "BID_INCREASE"
                                    ? "text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded"
                                    : tier.action === "PAUSE_TARGET"
                                    ? "text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
                                    : "text-rose-600 bg-rose-50 px-2 py-0.5 rounded"
                                }`}
                              >
                                {tier.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-800 font-sans font-medium">
                              {tier.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* General Logic & Budget Rule Overview Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="space-y-2">
                  <h5 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders size={14} className="text-indigo-600" />
                    <span>Quy Tắc Tính Bid Chung (General Bid Logic)</span>
                  </h5>
                  <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4 font-medium">
                    <li><strong>Tăng Bid:</strong> Tính trên gốc <code>Current Bid</code> (Ví dụ: +8% hoặc +5% Current Bid).</li>
                    <li><strong>Giảm Bid:</strong> Tính trên gốc <code>Avg CPC</code> (Ví dụ: -8%, -10%, -15% Avg CPC thực tế).</li>
                    <li><strong>Trần động theo SKU/phôi:</strong> Bid cuối không vượt <code>Max Bid SKU = CR × Profit Before Ads</code>.</li>
                    <li><strong>Ưu Tiên Tạm Dừng:</strong> <code>PAUSE</code> luôn có độ ưu tiên cao nhất, khử trùng lặp các hành động khác.</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h5 className="text-xs font-black text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle size={14} className="text-emerald-600" />
                    <span>Quy Tắc Tăng Ngân Sách (Budget Rule - Chu Kỳ 3 Ngày)</span>
                  </h5>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    {selectedRuleType === "SP03" ? (
                      <>Điều kiện: Khi <code>ACoS &lt; Break-even ACoS + 15%</code> ➔ Đề xuất <strong>Tăng ngân sách từ +30% đến +100%</strong> (Đánh giá lại sau 3 ngày).</>
                    ) : (
                      <>Điều kiện: Khi <code>ACoS &lt; Break-even ACoS</code> của SKU ➔ Đề xuất <strong>Tăng ngân sách từ +30% đến +100%</strong> (Đánh giá lại sau 3 ngày).</>
                    )}
                  </p>
                  <div className="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100 text-[11px] text-indigo-900 font-semibold">
                    Mã bộ luật: <code>amazon_ppc_common_bid_rules ({currentRule.version})</code> • Tối ưu cấp độ Target/Keyword
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* HISTORY TAB */
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900 uppercase">LỊCH SỬ XUẤT BULK FILE AMAZON</h3>
            <span className="text-xs text-slate-500 font-medium">
              Đã ghi nhận: <strong className="text-slate-900 font-bold">{bulkHistory.length}</strong> đợt xuất file
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-extrabold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Tên File</th>
                  <th className="py-3 px-4 text-center">Tổng Actions</th>
                  <th className="py-3 px-4 text-center">Update Bid</th>
                  <th className="py-3 px-4 text-center">Pause</th>
                  <th className="py-3 px-4 text-center">Trạng thái</th>
                  <th className="py-3 px-4 text-center">Thời gian xuất</th>
                  <th className="py-3 px-4 text-center">Tải lại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {bulkHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Chưa có file bulk nào được xuất.
                    </td>
                  </tr>
                ) : (
                  bulkHistory.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-mono font-bold text-indigo-700">
                        {exp.fileName}
                      </td>
                      <td className="py-3 px-4 text-center font-bold">
                        {exp.actionCount}
                      </td>
                      <td className="py-3 px-4 text-center text-emerald-700 font-bold font-mono">
                        {exp.summary?.updateBidCount ?? 0}
                      </td>
                      <td className="py-3 px-4 text-center text-amber-700 font-bold font-mono">
                        {exp.summary?.pauseCount ?? 0}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {exp.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">
                        {new Date(exp.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-[11px] border border-emerald-200">
                          <CheckCircle size={14} weight="bold" /> Sẵn sàng
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
