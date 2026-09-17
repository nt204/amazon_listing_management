"use client";

import { useState, useMemo } from "react";
import {
  X,
  Clock,
  Trash,
  DownloadSimple,
  CheckCircle,
  WarningCircle,
  ArrowUpRight,
  Pause,
  CheckSquare,
  Square,
  FileXls,
  ArrowsClockwise,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import type { BulkExport, PpcAction } from "@/lib/ppc/sku-architecture-types";

interface PpcActionQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  actions: PpcAction[];
  onRemoveAction: (actionId: string) => Promise<void>;
  onExportBulk: (selectedActionIds?: string[]) => Promise<void>;
  bulkHistory: BulkExport[];
  onRefreshBulkHistory: () => void;
  storeName: string;
}

export function PpcActionQueueDrawer({
  isOpen,
  onClose,
  actions,
  onRemoveAction,
  onExportBulk,
  bulkHistory,
  onRefreshBulkHistory,
  storeName,
}: PpcActionQueueDrawerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExportWizardOpen, setIsExportWizardOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Toggle select
  const handleToggleSelectAll = () => {
    if (selectedIds.size === actions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(actions.map((a) => a.id)));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Summary counts for Wizard
  const targetActions = useMemo(() => {
    return selectedIds.size > 0
      ? actions.filter((a) => selectedIds.has(a.id))
      : actions;
  }, [actions, selectedIds]);

  const summary = useMemo(() => {
    let updateBid = 0;
    let pause = 0;
    let budget = 0;
    for (const a of targetActions) {
      if (a.actionType === "UPDATE_BID") updateBid++;
      else if (a.actionType === "PAUSE_TARGET") pause++;
      else if (a.actionType === "UPDATE_BUDGET") budget++;
    }
    return { updateBid, pause, budget, total: targetActions.length };
  }, [targetActions]);

  // Validation checks
  const validation = useMemo(() => {
    const missingCampaignId = targetActions.filter((a) => !a.campaignId);
    const missingAdGroupId = targetActions.filter((a) => !a.adGroupId);
    const missingTargetId = targetActions.filter((a) => !a.targetId);
    const invalidBid = targetActions.filter(
      (a) => a.actionType === "UPDATE_BID" && (a.finalValue === null || a.finalValue <= 0)
    );

    const isValid =
      missingCampaignId.length === 0 &&
      missingAdGroupId.length === 0 &&
      missingTargetId.length === 0 &&
      invalidBid.length === 0;

    return {
      isValid,
      missingCampaignId: missingCampaignId.length,
      missingAdGroupId: missingAdGroupId.length,
      missingTargetId: missingTargetId.length,
      invalidBid: invalidBid.length,
    };
  }, [targetActions]);

  const handleExecuteDownload = async () => {
    try {
      setIsDownloading(true);
      const actionIds = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      await onExportBulk(actionIds);
      setIsExportWizardOpen(false);
      onClose();
    } catch (err) {
      alert("Lỗi khi tải file: " + String(err));
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs transition">
        <div className="w-full max-w-2xl bg-white border-l border-slate-200 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="space-y-5 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                  <Clock size={20} weight="bold" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">ACTION QUEUE</h2>
                  <p className="text-xs text-slate-500">
                    <strong className="text-sky-700">{actions.length}</strong> hành động đã duyệt sẵn sàng xuất file
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleSelectAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold cursor-pointer"
                >
                  {selectedIds.size === actions.length && actions.length > 0 ? (
                    <CheckSquare size={15} className="text-indigo-600" weight="fill" />
                  ) : (
                    <Square size={15} />
                  )}
                  <span>Chọn tất cả ({actions.length})</span>
                </button>
                {selectedIds.size > 0 && (
                  <span className="text-indigo-600 font-bold">Đã chọn {selectedIds.size}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsExportWizardOpen(true)}
                  disabled={actions.length === 0}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-xs disabled:opacity-40 cursor-pointer"
                >
                  <FileXls size={16} weight="bold" />
                  {selectedIds.size > 0 ? `Xuất đã chọn (${selectedIds.size})` : "Xuất tất cả Bulk File"}
                </button>
              </div>
            </div>

            {/* Actions Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white max-h-[60vh] shadow-2xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-slate-600 sticky top-0 border-b border-slate-200 font-bold z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-8"></th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Campaign</th>
                    <th className="py-2.5 px-3">Target</th>
                    <th className="py-2.5 px-3">Hành động</th>
                    <th className="py-2.5 px-3 text-right">Old</th>
                    <th className="py-2.5 px-3 text-right">New</th>
                    <th className="py-2.5 px-3">Nguồn</th>
                    <th className="py-2.5 px-3 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {actions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                        Hàng đợi trống. Hãy duyệt đề xuất từ tab <strong>Đề xuất</strong> để thêm vào hàng đợi.
                      </td>
                    </tr>
                  ) : (
                    actions.map((act) => {
                      const isSelected = selectedIds.has(act.id);
                      return (
                        <tr
                          key={act.id}
                          className={`hover:bg-indigo-50/20 transition ${
                            isSelected ? "bg-indigo-50/40" : ""
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <button
                              onClick={() => handleToggleSelectOne(act.id)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare size={15} className="text-indigo-600" weight="fill" />
                              ) : (
                                <Square size={15} />
                              )}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-indigo-700">
                            {act.sku || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 max-w-[120px] truncate" title={act.campaignName}>
                            {act.campaignName}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900 max-w-[140px] truncate" title={act.targetKeyword}>
                            {act.targetKeyword}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {act.actionType === "PAUSE_TARGET" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                <Pause size={12} weight="bold" /> Pause
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <ArrowUpRight size={12} weight="bold" /> Update Bid
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                            {act.oldValue ? `$${act.oldValue.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-black text-indigo-700 font-mono">
                            {act.actionType === "PAUSE_TARGET" ? "—" : `$${(act.finalValue || 0).toFixed(2)}`}
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-slate-500">
                            {act.ruleVersion}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={() => onRemoveAction(act.id)}
                              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-rose-600 transition cursor-pointer"
                              title="Xóa khỏi hàng đợi"
                            >
                              <Trash size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Bulk export history lives next to the queue that produced it. */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <ClockCounterClockwise size={16} className="text-slate-500" weight="bold" />
                  <div>
                    <h3 className="text-xs font-black text-slate-800">Lịch sử xuất Bulk</h3>
                    <p className="text-[11px] text-slate-500">{bulkHistory.length} file đã tạo từ Action Queue</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onRefreshBulkHistory}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] cursor-pointer"
                  title="Tải lại lịch sử"
                >
                  <ArrowsClockwise size={15} weight="bold" />
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto">
                {bulkHistory.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">
                    Chưa có file Bulk nào được xuất.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {bulkHistory.map((item) => (
                      <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <FileXls size={14} className="shrink-0 text-emerald-600" weight="fill" />
                            <span className="truncate text-xs font-bold text-slate-800" title={item.fileName}>{item.fileName}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                            <span>{item.actionCount} actions</span>
                            <span className="text-emerald-700">Bid: {item.summary.updateBidCount || 0}</span>
                            <span className="text-amber-700">Pause: {item.summary.pauseCount || 0}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold text-emerald-700">{item.status}</div>
                          <time className="mt-0.5 block whitespace-nowrap text-[10px] text-slate-400">
                            {new Date(item.createdAt).toLocaleString("vi-VN")}
                          </time>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Chỉ các hành động trong <strong>Action Queue</strong> mới được xuất ra file Bulk Amazon.
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>

      {/* BULK EXPORT WIZARD MODAL */}
      {isExportWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">EXPORT AMAZON BULK</h3>
                <p className="text-xs text-slate-500 mt-0.5">Shop: {storeName || "Warmstorey US"}</p>
              </div>
              <button
                onClick={() => setIsExportWizardOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Breakdown */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2 text-xs">
              <div className="text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1">
                Tổng cộng {summary.total} hành động
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>Update Bid:</span>
                <strong className="text-emerald-700 font-mono text-sm">{summary.updateBid}</strong>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>Pause Target:</span>
                <strong className="text-amber-700 font-mono text-sm">{summary.pause}</strong>
              </div>
              {summary.budget > 0 && (
                <div className="flex justify-between items-center text-slate-700">
                  <span>Budget:</span>
                  <strong className="text-sky-700 font-mono text-sm">{summary.budget}</strong>
                </div>
              )}
            </div>

            {/* Validation checklist */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
              <div className="text-[11px] font-black text-slate-700 uppercase tracking-wider mb-1">
                Kiểm tra tính hợp lệ (Validation)
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <CheckCircle size={16} weight="fill" className="text-emerald-600" />
                <span>Campaign ID đầy đủ</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <CheckCircle size={16} weight="fill" className="text-emerald-600" />
                <span>Ad Group ID đầy đủ</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <CheckCircle size={16} weight="fill" className="text-emerald-600" />
                <span>Target ID đầy đủ</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <CheckCircle size={16} weight="fill" className="text-emerald-600" />
                <span>Bid nằm trong giới hạn trần/sàn</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <CheckCircle size={16} weight="fill" className="text-emerald-600" />
                <span>Đã khử trùng lặp (PAUSE &gt; UPDATE_BID)</span>
              </div>

              {!validation.isValid && (
                <div className="pt-2 text-rose-700 font-bold text-xs flex items-center gap-1.5">
                  <WarningCircle size={16} weight="fill" className="text-rose-600" />
                  <span>Phát hiện dữ liệu thiếu ID hoặc bid không hợp lệ!</span>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                onClick={() => setIsExportWizardOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleExecuteDownload}
                disabled={!validation.isValid || isDownloading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <DownloadSimple size={16} weight="bold" />
                {isDownloading ? "Đang tạo file..." : "Tải Amazon Bulk File (.xlsx)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
