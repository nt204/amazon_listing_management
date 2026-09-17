"use client";

import { useState, useMemo } from "react";
import {
  MagnifyingGlass,
  PencilSimple,
  CheckCircle,
  X,
  Funnel,
  Tag,
  ArrowsClockwise,
  Info,
} from "@phosphor-icons/react";
import type { SkuEconomics, CrSource } from "@/lib/ppc/sku-architecture-types";
import {
  calculateBreakEvenAcos,
  calculateMaxBid,
  calculateProfitBeforeAds,
  SKU_PREFIX_ERROR_PRODUCT_TYPE,
} from "@/lib/ppc/sku-architecture-types";

interface PpcSkuEconomicsTableProps {
  skuList: SkuEconomics[];
  isLoading: boolean;
  onRefresh: () => void;
  onUpdateSku: (sku: string, data: Partial<SkuEconomics>) => Promise<void>;
}

export function PpcSkuEconomicsTable({
  skuList,
  isLoading,
  onRefresh,
  onUpdateSku,
}: PpcSkuEconomicsTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPhôi, setSelectedPhôi] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedSku, setSelectedSku] = useState<SkuEconomics | null>(null);

  // Edit Drawer state
  const [isEditing, setIsEditing] = useState(false);
  const [editPrice, setEditPrice] = useState("");
  const [editBaseCost, setEditBaseCost] = useState("");
  const [editFee, setEditFee] = useState("");
  const [editTaxRate, setEditTaxRate] = useState("");
  const [editCr, setEditCr] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Filtered SKUs
  const filteredList = useMemo(() => {
    return skuList.filter((item) => {
      const matchSearch =
        !searchTerm ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.asin.toLowerCase().includes(searchTerm.toLowerCase());
      const matchPhôi = selectedPhôi === "ALL" || item.productType === selectedPhôi;
      const matchStatus = statusFilter === "ALL" || item.ppcStatus === statusFilter;
      return matchSearch && matchPhôi && matchStatus;
    });
  }, [skuList, searchTerm, selectedPhôi, statusFilter]);

  // Open drawer
  const handleOpenDrawer = (item: SkuEconomics) => {
    setSelectedSku(item);
    setEditPrice(item.sellingPrice.toFixed(2));
    setEditBaseCost(item.baseCost.toFixed(2));
    setEditFee(item.amazonFee.toFixed(2));
    setEditTaxRate((item.taxRate * 100).toFixed(1));
    setEditCr((item.cr * 100).toFixed(1));
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!selectedSku) return;
    try {
      setIsSaving(true);
      const price = parseFloat(editPrice) || selectedSku.sellingPrice;
      const baseCost = parseFloat(editBaseCost) || selectedSku.baseCost;
      const fee = parseFloat(editFee) || selectedSku.amazonFee;
      const taxRate = (parseFloat(editTaxRate) || 3.0) / 100;
      const cr = (parseFloat(editCr) || selectedSku.cr * 100) / 100;

      await onUpdateSku(selectedSku.sku, {
        sellingPrice: price,
        baseCost,
        amazonFee: fee,
        taxRate,
        cr,
        costSource: "OVERRIDE",
        crSource: "OVERRIDE",
      });

      const profit = calculateProfitBeforeAds(price, fee, baseCost, taxRate);
      const beAcos = calculateBreakEvenAcos(profit, price);
      const maxBid = calculateMaxBid(cr, profit);

      setSelectedSku({
        ...selectedSku,
        sellingPrice: price,
        baseCost,
        amazonFee: fee,
        taxRate,
        profitBeforeAds: profit,
        breakEvenAcos: beAcos,
        cr,
        maxBid,
        costSource: "OVERRIDE",
        crSource: "OVERRIDE",
      });

      setIsEditing(false);
    } catch (err) {
      alert("Lỗi khi lưu thông số SKU: " + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Status badge styling
  const renderPpcStatusBadge = (status?: string) => {
    switch (status) {
      case "Healthy":
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Healthy
          </span>
        );
      case "Review":
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Review
          </span>
        );
      case "Bleeding":
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Bleeding
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
            Zero Clicks
          </span>
        );
    }
  };

  // Source badge
  const renderCrSourceBadge = (source?: CrSource) => {
    switch (source) {
      case "ACTUAL_30D":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            Actual 30D
          </span>
        );
      case "OVERRIDE":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
            Override
          </span>
        );
      case "INHERITED":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
            Inherited
          </span>
        );
      case "CALCULATED":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Calculated
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Assumed
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter and Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search box */}
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Tìm theo SKU hoặc ASIN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white w-56"
            />
          </div>

          {/* Phôi filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <Tag size={14} className="text-slate-400" />
            <span>Phôi:</span>
            <select
              value={selectedPhôi}
              onChange={(e) => setSelectedPhôi(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:border-indigo-600 cursor-pointer"
            >
              <option value="ALL">Tất cả Phôi</option>
              <option value="Ornament">Ornament</option>
              <option value="Bullet Tumbler">Bullet Tumbler</option>
              <option value="Blanket">Blanket</option>
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
            <Funnel size={14} className="text-slate-400" />
            <span>Trạng thái:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:border-indigo-600 cursor-pointer"
            >
              <option value="ALL">Tất cả</option>
              <option value="Healthy">Healthy</option>
              <option value="Review">Review</option>
              <option value="Bleeding">Bleeding</option>
              <option value="Zero Clicks">Zero Clicks</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">
            Hiển thị <strong className="text-slate-900 font-bold">{filteredList.length}</strong> / {skuList.length} SKU
          </span>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-800 transition disabled:opacity-50 cursor-pointer"
            title="Tải lại danh sách SKU"
          >
            <ArrowsClockwise size={15} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-bold">
            <tr>
              <th className="py-3 px-3">SKU</th>
              <th className="py-3 px-3">ASIN</th>
              <th className="py-3 px-3">Phôi</th>
              <th className="py-3 px-3 text-right">Price</th>
              <th className="py-3 px-3 text-right">Base Cost</th>
              <th className="py-3 px-3 text-right">Amz Fee</th>
              <th className="py-3 px-3 text-right">Profit Before Ads</th>
              <th className="py-3 px-3 text-right">BE ACoS</th>
              <th className="py-3 px-3 text-right">CR</th>
              <th className="py-3 px-3 text-right">Max Bid</th>
              <th className="py-3 px-3 text-center">PPC Status</th>
              <th className="py-3 px-3 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-10 text-center text-slate-400 font-medium">
                  Không tìm thấy SKU nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              filteredList.map((item) => (
                <tr
                  key={item.sku}
                  onClick={() => handleOpenDrawer(item)}
                  className="hover:bg-indigo-50/30 transition cursor-pointer group"
                >
                  <td className="py-3 px-3 font-bold text-slate-900 group-hover:text-indigo-600 transition">
                    {item.sku}
                  </td>
                  <td className="py-3 px-3 text-slate-500 font-mono">{item.asin || "—"}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                      item.productType === SKU_PREFIX_ERROR_PRODUCT_TYPE
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}>
                      {item.productType}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-900 font-bold font-mono">
                    ${item.sellingPrice.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600 font-mono">
                    ${item.baseCost.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600 font-mono">
                    ${item.amazonFee.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right font-black text-emerald-700 font-mono">
                    ${item.profitBeforeAds.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right font-black text-amber-700 font-mono">
                    {item.breakEvenAcos.toFixed(1)}%
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 font-mono font-medium">
                    {(item.cr * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 px-3 text-right font-black text-indigo-600 font-mono">
                    ${item.maxBid.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {renderPpcStatusBadge(item.ppcStatus)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDrawer(item);
                        setIsEditing(true);
                      }}
                      className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition cursor-pointer"
                      title="Chỉnh sửa thông số kinh tế"
                    >
                      <PencilSimple size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer Chi Tiết SKU */}
      {selectedSku && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs transition">
          <div className="w-full max-w-md bg-white border-l border-slate-200 p-6 flex flex-col justify-between overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900">SKU OVERVIEW</h2>
                    {renderPpcStatusBadge(selectedSku.ppcStatus)}
                  </div>
                  <p className="text-sm font-black text-indigo-600 mt-1">{selectedSku.sku}</p>
                  <p className="text-xs text-slate-500">ASIN: {selectedSku.asin || "Chưa gán"} • Phôi: {selectedSku.productType}</p>
                </div>
                <button
                  onClick={() => setSelectedSku(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Block 1: ECONOMICS */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    ECONOMICS
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    Nguồn Cost:{" "}
                    <strong className="text-slate-800">
                      {selectedSku.costSource === "OVERRIDE" ? "Tự định nghĩa (Override)" : "Kế thừa từ Phôi (Inherited)"}
                    </strong>
                  </span>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Price (Giá bán):</span>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-right text-slate-900 font-mono text-xs focus:border-indigo-600 focus:outline-none"
                      />
                    ) : (
                      <span className="font-bold text-slate-900 font-mono">
                        ${selectedSku.sellingPrice.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Base Cost (Giá vốn phôi):</span>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editBaseCost}
                        onChange={(e) => setEditBaseCost(e.target.value)}
                        className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-right text-slate-900 font-mono text-xs focus:border-indigo-600 focus:outline-none"
                      />
                    ) : (
                      <span className="font-mono text-slate-700">
                        ${selectedSku.baseCost.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Amazon Fee (Phí Amazon):</span>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editFee}
                        onChange={(e) => setEditFee(e.target.value)}
                        className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-right text-slate-900 font-mono text-xs focus:border-indigo-600 focus:outline-none"
                      />
                    ) : (
                      <span className="font-mono text-slate-700">
                        ${selectedSku.amazonFee.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Tax Rate (Thuế):</span>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.1"
                        value={editTaxRate}
                        onChange={(e) => setEditTaxRate(e.target.value)}
                        className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-right text-slate-900 font-mono text-xs focus:border-indigo-600 focus:outline-none"
                      />
                    ) : (
                      <span className="font-mono text-slate-700">
                        {(selectedSku.taxRate * 100).toFixed(1)}% (${(selectedSku.sellingPrice * selectedSku.taxRate).toFixed(2)})
                      </span>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                    <span className="font-bold text-slate-800">Profit Before Ads:</span>
                    <span className="font-black text-emerald-700 font-mono text-sm">
                      ${selectedSku.profitBeforeAds.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-800">Break-even ACoS:</span>
                    <span className="font-black text-amber-700 font-mono text-sm">
                      {selectedSku.breakEvenAcos.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Block 2: PPC INPUT */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    PPC INPUT
                  </h3>
                  {renderCrSourceBadge(selectedSku.crSource)}
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Conversion Rate (CR):</span>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.1"
                        value={editCr}
                        onChange={(e) => setEditCr(e.target.value)}
                        className="w-24 px-2 py-1 bg-white border border-slate-300 rounded text-right text-slate-900 font-mono text-xs focus:border-indigo-600 focus:outline-none"
                      />
                    ) : (
                      <span className="font-mono text-slate-900 font-bold">
                        {(selectedSku.cr * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">CR Source:</span>
                    <span className="font-mono text-slate-700">
                      {selectedSku.crSource}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                    <span className="font-bold text-slate-800">Max Bid:</span>
                    <span className="font-black text-indigo-600 font-mono text-base">
                      ${selectedSku.maxBid.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notice */}
              <div className="bg-indigo-50/60 rounded-xl p-3 border border-indigo-100 text-[11px] text-slate-600 flex items-start gap-2">
                <Info size={16} className="text-indigo-600 flex-shrink-0 mt-0.5" />
                <p>
                  Công thức: <code className="text-indigo-800 font-bold">Profit = Price - Fee - Base - Tax</code>.
                  <br />
                  <code className="text-indigo-800 font-bold">BE ACoS = Profit / Price</code>.
                  <br />
                  <code className="text-indigo-800 font-bold">Max Bid = CR × Profit Before Ads</code>.
                </p>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
              {isEditing ? (
                <>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle size={16} weight="bold" />
                    {isSaving ? "Đang lưu..." : "Lưu Thông Số"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  <PencilSimple size={15} />
                  Chỉnh sửa giá trị riêng
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
