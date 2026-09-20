"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
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
  Lightning,
  SpinnerGap,
  ShieldCheck,
  Browser,
  Check,
  Funnel,
  CaretRight,
  CaretDown,
  Megaphone,
} from "@phosphor-icons/react";
import type { BulkExport, PpcAction, PpcAutoUploadLog } from "@/lib/ppc/sku-architecture-types";

export interface ActionCampaignGroup {
  campaignName: string;
  campaignId?: string;
  actions: PpcAction[];
  totalActions: number;
  updateBidCount: number;
  pauseCount: number;
  budgetCount: number;
  avgOldBid: number | null;
  avgNewBid: number | null;
}

export interface ActionSkuGroup {
  sku: string;
  isZeroSpend: boolean;
  actions: PpcAction[];
  campaigns: string[];
  campaignGroups: ActionCampaignGroup[];
  totalActions: number;
  updateBidCount: number;
  pauseCount: number;
  budgetCount: number;
  avgOldBid: number | null;
  avgNewBid: number | null;
}

interface PpcActionQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  actions: PpcAction[];
  onRemoveAction: (actionId: string) => Promise<void>;
  onRemoveActions?: (actionIds: string[]) => Promise<void>;
  onExportBulk: (selectedActionIds?: string[]) => Promise<void>;
  bulkHistory: BulkExport[];
  onRefreshBulkHistory: () => void;
  storeName: string;
  storeId?: string;
  onRefreshActionQueue?: () => void;
}

export function PpcActionQueueDrawer({
  isOpen,
  onClose,
  actions,
  onRemoveAction,
  onRemoveActions,
  onExportBulk,
  bulkHistory,
  onRefreshBulkHistory,
  storeName,
  storeId,
  onRefreshActionQueue,
}: PpcActionQueueDrawerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExportWizardOpen, setIsExportWizardOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // Filter by SKU
  const [selectedSkuFilter, setSelectedSkuFilter] = useState<string>("ALL");

  // Auto Upload State
  const [isAutoUploadModalOpen, setIsAutoUploadModalOpen] = useState(false);
  const [skuModalTarget, setSkuModalTarget] = useState<string>("ALL");
  const [isAutoUploading, setIsAutoUploading] = useState(false);
  const [autoUploadStep, setAutoUploadStep] = useState<number>(0); // 0: Idle, 1: Prep, 2: AdsPower, 3: Upload, 4: Done
  const [autoUploadError, setAutoUploadError] = useState<string | null>(null);
  const [autoUploadSuccess, setAutoUploadSuccess] = useState<string | null>(null);

  // Auto Upload Logs State
  const [activeHistoryTab, setActiveHistoryTab] = useState<"BULK" | "AUTO">("BULK");
  const [autoLogs, setAutoLogs] = useState<PpcAutoUploadLog[]>([]);
  const [isLoadingAutoLogs, setIsLoadingAutoLogs] = useState(false);

  // Keyboard shortcut: ESC to close modal or drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (isAutoUploadModalOpen) {
          if (!isAutoUploading) setIsAutoUploadModalOpen(false);
        } else if (isExportWizardOpen) {
          setIsExportWizardOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isAutoUploadModalOpen, isExportWizardOpen, isAutoUploading, onClose]);

  // Available SKUs in Action Queue
  const availableSkus = useMemo(() => {
    const map = new Map<string, { count: number; isZeroSpend: boolean }>();
    for (const act of actions) {
      const s = (act.sku || "UNKNOWN").toUpperCase();
      const curr = map.get(s) || { count: 0, isZeroSpend: !!act.isZeroSpend };
      curr.count++;
      map.set(s, curr);
    }
    return Array.from(map.entries())
      .map(([sku, data]) => ({ sku, count: data.count, isZeroSpend: data.isZeroSpend }))
      .sort((a, b) => b.count - a.count);
  }, [actions]);

  // Actions displayed after SKU filter
  const displayedActions = useMemo(() => {
    if (selectedSkuFilter === "ALL") return actions;
    return actions.filter((a) => (a.sku || "").toUpperCase() === selectedSkuFilter.toUpperCase());
  }, [actions, selectedSkuFilter]);

  // Group actions by SKU and Campaign
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());
  const [collapsedCampaigns, setCollapsedCampaigns] = useState<Set<string>>(new Set());

  const skuGroups = useMemo<ActionSkuGroup[]>(() => {
    type AccCamp = {
      campaignName: string;
      campaignId?: string;
      actions: PpcAction[];
      totalActions: number;
      updateBidCount: number;
      pauseCount: number;
      budgetCount: number;
      avgOldBid: number | null;
      avgNewBid: number | null;
      _totalOldBid: number;
      _countOldBid: number;
      _totalNewBid: number;
      _countNewBid: number;
    };

    type AccGroup = {
      sku: string;
      isZeroSpend: boolean;
      actions: PpcAction[];
      campaigns: string[];
      campMap: Map<string, AccCamp>;
      totalActions: number;
      updateBidCount: number;
      pauseCount: number;
      budgetCount: number;
      avgOldBid: number | null;
      avgNewBid: number | null;
      _totalOldBid: number;
      _countOldBid: number;
      _totalNewBid: number;
      _countNewBid: number;
    };

    const map = new Map<string, AccGroup>();
    for (const act of displayedActions) {
      const sku = (act.sku || "UNKNOWN").toUpperCase();
      let group = map.get(sku);
      if (!group) {
        group = {
          sku,
          isZeroSpend: !!act.isZeroSpend,
          actions: [],
          campaigns: [],
          campMap: new Map(),
          totalActions: 0,
          updateBidCount: 0,
          pauseCount: 0,
          budgetCount: 0,
          avgOldBid: null,
          avgNewBid: null,
          _totalOldBid: 0,
          _countOldBid: 0,
          _totalNewBid: 0,
          _countNewBid: 0,
        };
        map.set(sku, group);
      }
      group.actions.push(act);
      group.totalActions++;

      const campName = act.campaignName || "Chiến dịch chưa đặt tên";
      if (!group.campaigns.includes(campName)) {
        group.campaigns.push(campName);
      }

      let campGroup = group.campMap.get(campName);
      if (!campGroup) {
        campGroup = {
          campaignName: campName,
          campaignId: act.campaignId,
          actions: [],
          totalActions: 0,
          updateBidCount: 0,
          pauseCount: 0,
          budgetCount: 0,
          avgOldBid: null,
          avgNewBid: null,
          _totalOldBid: 0,
          _countOldBid: 0,
          _totalNewBid: 0,
          _countNewBid: 0,
        };
        group.campMap.set(campName, campGroup);
      }
      campGroup.actions.push(act);
      campGroup.totalActions++;

      if (act.oldValue !== null && act.oldValue !== undefined && act.oldValue > 0) {
        group._totalOldBid += act.oldValue;
        group._countOldBid++;
        campGroup._totalOldBid += act.oldValue;
        campGroup._countOldBid++;
      }

      if (act.actionType === "UPDATE_BID") {
        group.updateBidCount++;
        campGroup.updateBidCount++;
        const val = act.finalValue ?? 0;
        if (val > 0) {
          group._totalNewBid += val;
          group._countNewBid++;
          campGroup._totalNewBid += val;
          campGroup._countNewBid++;
        }
      } else if (act.actionType === "PAUSE_TARGET") {
        group.pauseCount++;
        campGroup.pauseCount++;
      } else if (act.actionType === "UPDATE_BUDGET") {
        group.budgetCount++;
        campGroup.budgetCount++;
      }
    }

    const groups: ActionSkuGroup[] = Array.from(map.values()).map((g) => {
      g.avgOldBid = g._countOldBid > 0 ? g._totalOldBid / g._countOldBid : null;
      g.avgNewBid = g._countNewBid > 0 ? g._totalNewBid / g._countNewBid : null;

      const campaignGroups: ActionCampaignGroup[] = Array.from(g.campMap.values())
        .map((cg) => {
          cg.avgOldBid = cg._countOldBid > 0 ? cg._totalOldBid / cg._countOldBid : null;
          cg.avgNewBid = cg._countNewBid > 0 ? cg._totalNewBid / cg._countNewBid : null;
          return {
            campaignName: cg.campaignName,
            campaignId: cg.campaignId,
            actions: cg.actions,
            totalActions: cg.totalActions,
            updateBidCount: cg.updateBidCount,
            pauseCount: cg.pauseCount,
            budgetCount: cg.budgetCount,
            avgOldBid: cg.avgOldBid,
            avgNewBid: cg.avgNewBid,
          };
        })
        .sort((a, b) => b.totalActions - a.totalActions);

      return {
        sku: g.sku,
        isZeroSpend: g.isZeroSpend,
        actions: g.actions,
        campaigns: g.campaigns,
        campaignGroups,
        totalActions: g.totalActions,
        updateBidCount: g.updateBidCount,
        pauseCount: g.pauseCount,
        budgetCount: g.budgetCount,
        avgOldBid: g.avgOldBid,
        avgNewBid: g.avgNewBid,
      };
    });

    return groups.sort((a, b) => b.totalActions - a.totalActions);
  }, [displayedActions]);

  const handleToggleExpandSku = (sku: string) => {
    const next = new Set(expandedSkus);
    if (next.has(sku)) {
      next.delete(sku);
    } else {
      next.add(sku);
    }
    setExpandedSkus(next);
  };

  const handleToggleExpandCampaign = (sku: string, campaignName: string) => {
    const key = `${sku}::${campaignName}`;
    const next = new Set(collapsedCampaigns);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setCollapsedCampaigns(next);
  };

  const handleExpandAll = () => {
    setExpandedSkus(new Set(skuGroups.map((g) => g.sku)));
    setCollapsedCampaigns(new Set());
  };

  const handleCollapseAll = () => {
    setExpandedSkus(new Set());
    setCollapsedCampaigns(new Set());
  };

  const handleToggleGroupSelect = (group: ActionSkuGroup) => {
    const groupIds = group.actions.map((a) => a.id);
    const allSelected = groupIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      groupIds.forEach((id) => next.delete(id));
    } else {
      groupIds.forEach((id) => next.add(id));
    }
    setSelectedIds(next);
  };

  const handleToggleCampaignSelect = (campGroup: ActionCampaignGroup) => {
    const campIds = campGroup.actions.map((a) => a.id);
    const allSelected = campIds.length > 0 && campIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      campIds.forEach((id) => next.delete(id));
    } else {
      campIds.forEach((id) => next.add(id));
    }
    setSelectedIds(next);
  };

  const handleDeleteSkuGroup = async (group: ActionSkuGroup) => {
    const confirmed = window.confirm(`Bạn có chắc chắn muốn xóa tất cả ${group.totalActions} hành động của SKU ${group.sku}?`);
    if (!confirmed) return;
    const groupIds = group.actions.map((a) => a.id);
    if (onRemoveActions) {
      await onRemoveActions(groupIds);
    } else {
      for (const id of groupIds) {
        await onRemoveAction(id);
      }
    }
    const next = new Set(selectedIds);
    groupIds.forEach((id) => next.delete(id));
    setSelectedIds(next);
  };

  const handleDeleteCampaignGroup = async (campGroup: ActionCampaignGroup) => {
    const confirmed = window.confirm(`Bạn có chắc chắn muốn xóa tất cả ${campGroup.totalActions} hành động trong chiến dịch "${campGroup.campaignName}"?`);
    if (!confirmed) return;
    const campIds = campGroup.actions.map((a) => a.id);
    if (onRemoveActions) {
      await onRemoveActions(campIds);
    } else {
      for (const id of campIds) {
        await onRemoveAction(id);
      }
    }
    const next = new Set(selectedIds);
    campIds.forEach((id) => next.delete(id));
    setSelectedIds(next);
  };

  // Toggle select for current view
  const handleToggleSelectAll = () => {
    const currentIds = displayedActions.map((a) => a.id);
    const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      currentIds.forEach((id) => next.delete(id));
    } else {
      currentIds.forEach((id) => next.add(id));
    }
    setSelectedIds(next);
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

  // Summary counts for Wizard & Execution
  const targetActions = useMemo(() => {
    if (selectedIds.size > 0) {
      return actions.filter((a) => selectedIds.has(a.id));
    }
    if (selectedSkuFilter !== "ALL") {
      return displayedActions;
    }
    return actions;
  }, [actions, selectedIds, selectedSkuFilter, displayedActions]);

  // Actions specifically for Zero Spend (SKU chưa cắn tiền)
  const zeroSpendCandidates = useMemo(() => {
    return targetActions.filter((a) => a.isZeroSpend);
  }, [targetActions]);

  const zeroSpendCandidateCount = zeroSpendCandidates.length;

  const uniqueZeroSpendSkus = useMemo(() => {
    return Array.from(new Set(zeroSpendCandidates.map((a) => a.sku).filter(Boolean)));
  }, [zeroSpendCandidates]);

  // Zero-spend candidates filtered by modal target (if user picks a specific SKU inside the modal)
  const modalZeroSpendCandidates = useMemo(() => {
    if (skuModalTarget === "ALL") {
      return zeroSpendCandidates;
    }
    return zeroSpendCandidates.filter(
      (a) => (a.sku || "").toUpperCase() === skuModalTarget.toUpperCase()
    );
  }, [zeroSpendCandidates, skuModalTarget]);

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

  // Load Auto Upload Logs
  const loadAutoLogs = useCallback(async () => {
    try {
      setIsLoadingAutoLogs(true);
      const url = storeId
        ? `/api/ppc/auto-upload?storeId=${encodeURIComponent(storeId)}`
        : `/api/ppc/auto-upload`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setAutoLogs(json.data);
        }
      }
    } catch {
      // Bỏ qua lỗi mạng nền
    } finally {
      setIsLoadingAutoLogs(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (isOpen) {
      void loadAutoLogs();
    }
  }, [isOpen, loadAutoLogs]);

  const handleExecuteDownload = async () => {
    try {
      setIsDownloading(true);
      const actionIds = targetActions.map((a) => a.id);
      await onExportBulk(actionIds.length > 0 ? actionIds : undefined);
      setIsExportWizardOpen(false);
      onClose();
    } catch (err) {
      alert("Lỗi khi tải file: " + String(err));
    } finally {
      setIsDownloading(false);
    }
  };

  // Batch delete selected actions
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = window.confirm(`Bạn có chắc chắn muốn xóa ${count} hành động đang chọn khỏi Action Queue?`);
    if (!confirmed) return;

    try {
      setIsBatchDeleting(true);
      const actionIds = Array.from(selectedIds);
      if (onRemoveActions) {
        await onRemoveActions(actionIds);
      } else {
        for (const id of actionIds) {
          await onRemoveAction(id);
        }
      }
      setSelectedIds(new Set());
    } catch (err: any) {
      alert("Lỗi khi xóa hành động: " + String(err?.message || err));
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // Open Auto Upload modal with smart pre-selected SKU
  const handleOpenAutoUploadModal = () => {
    setAutoUploadError(null);
    setAutoUploadSuccess(null);
    setAutoUploadStep(0);
    // If filtering by SKU, pre-select that SKU in modal
    if (selectedSkuFilter !== "ALL") {
      setSkuModalTarget(selectedSkuFilter);
    } else {
      setSkuModalTarget("ALL");
    }
    setIsAutoUploadModalOpen(true);
  };

  // Execute Auto Upload AdsPower for Zero Spend SKUs
  const handleExecuteAutoUpload = async () => {
    try {
      setIsAutoUploading(true);
      setAutoUploadError(null);
      setAutoUploadSuccess(null);
      setAutoUploadStep(1); // 1. Lọc actions

      await new Promise((r) => setTimeout(r, 500));
      setAutoUploadStep(2); // 2. Tạo file & kết nối AdsPower

      const actionIds = modalZeroSpendCandidates.map((a) => a.id);
      const res = await fetch("/api/ppc/auto-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeId || undefined,
          actionIds,
        }),
      });

      setAutoUploadStep(3); // 3. Uploading to Amazon Ads

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Tự động upload thất bại.");
      }

      // Ghi nhận thành công - không tự động trigger a.click() để tránh bật hộp thoại Save As của máy
      setAutoUploadStep(4); // 4. Hoàn thành
      setAutoUploadSuccess(data.message || `Đã tự động upload thành công file ${data.fileName || ""} lên Amazon Ads Bulk Operations!`);

      // Refresh dữ liệu
      void loadAutoLogs();
      onRefreshBulkHistory();
      if (onRefreshActionQueue) {
        onRefreshActionQueue();
      }
    } catch (err: any) {
      setAutoUploadError(err?.message || String(err));
    } finally {
      setIsAutoUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs transition"
        onClick={onClose}
      >
        {/* Rộng rãi & Thoải mái: max-w-6xl, xl:max-w-7xl, 2xl:max-w-[96vw] để hiển thị đầy đủ tên chiến dịch mà không bị co ép */}
        <div
          className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[96vw] bg-white border-l border-slate-200 p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200 h-full overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-5 overflow-y-auto flex-1 pr-1">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                  <Clock size={22} weight="bold" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900">ACTION QUEUE</h2>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-black">
                      {actions.length} actions
                    </span>
                    {zeroSpendCandidateCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-black">
                        ⚡ {zeroSpendCandidateCount} action SKU chưa cắn tiền
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Hàng đợi duyệt đề xuất tối ưu hóa Bid & Target sẵn sàng xuất Bulk và tự động tải lên Amazon.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose();
                }}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition cursor-pointer shrink-0"
                title="Đóng (Esc)"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            {/* Action Bar with SKU selector & filter */}
            <div className="flex flex-wrap items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs gap-3">
              {/* Left: Select All & Filter by SKU */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={handleToggleSelectAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold cursor-pointer"
                >
                  {displayedActions.length > 0 && displayedActions.every((a) => selectedIds.has(a.id)) ? (
                    <CheckSquare size={15} className="text-indigo-600" weight="fill" />
                  ) : (
                    <Square size={15} />
                  )}
                  <span>
                    Chọn tất cả {selectedSkuFilter !== "ALL" ? `SKU ${selectedSkuFilter}` : ""} ({displayedActions.length})
                  </span>
                </button>

                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs border border-indigo-200">
                      Đã chọn {selectedIds.size}
                    </span>
                    <button
                      type="button"
                      onClick={handleBatchDelete}
                      disabled={isBatchDeleting}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 font-bold text-xs border border-rose-200 transition cursor-pointer disabled:opacity-50"
                      title={`Xóa ${selectedIds.size} hành động đang chọn khỏi hàng đợi`}
                    >
                      {isBatchDeleting ? (
                        <SpinnerGap size={13} className="animate-spin" />
                      ) : (
                        <Trash size={13} weight="bold" />
                      )}
                      <span>Xóa đã chọn ({selectedIds.size})</span>
                    </button>
                  </div>
                )}

                {/* SKU Selector Dropdown */}
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs shadow-2xs">
                  <Funnel size={13} className="text-slate-400" weight="bold" />
                  <span className="text-slate-400 font-semibold">Lọc theo SKU:</span>
                  <select
                    value={selectedSkuFilter}
                    onChange={(e) => setSelectedSkuFilter(e.target.value)}
                    className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer max-w-[200px] truncate"
                  >
                    <option value="ALL">Tất cả SKU ({actions.length})</option>
                    {availableSkus.map(({ sku, count, isZeroSpend }) => (
                      <option key={sku} value={sku}>
                        {sku} ({count}) {isZeroSpend ? "• Chưa cắn tiền" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedSkuFilter !== "ALL" && (
                  <button
                    onClick={() => setSelectedSkuFilter("ALL")}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 text-xs font-bold cursor-pointer"
                    title="Bỏ lọc SKU"
                  >
                    <span>{selectedSkuFilter}</span>
                    <X size={12} weight="bold" />
                  </button>
                )}
              </div>

              {/* Right: Auto Upload & Bulk Export Buttons */}
              <div className="flex items-center gap-2">
                {/* Nút Auto Upload AdsPower dành riêng cho SKU chưa cắn tiền */}
                <button
                  onClick={handleOpenAutoUploadModal}
                  disabled={zeroSpendCandidateCount === 0}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-black transition shadow-xs disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                  title={
                    zeroSpendCandidateCount === 0
                      ? "Không có action nào thuộc SKU chưa cắn tiền để Auto Upload"
                      : `Tự động xuất & mở AdsPower upload ${zeroSpendCandidateCount} action SKU chưa cắn tiền`
                  }
                >
                  <Lightning size={15} weight="fill" />
                  <span>Auto Upload AdsPower</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-black/20 text-[10px] font-black leading-none">
                    {zeroSpendCandidateCount}
                  </span>
                </button>

                {/* Nút Xuất File Bulk thường */}
                <button
                  onClick={() => setIsExportWizardOpen(true)}
                  disabled={actions.length === 0}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-xs disabled:opacity-40 cursor-pointer"
                >
                  <FileXls size={15} weight="bold" />
                  <span>
                    {selectedIds.size > 0
                      ? `Xuất đã chọn (${selectedIds.size})`
                      : selectedSkuFilter !== "ALL"
                      ? `Xuất SKU ${selectedSkuFilter} (${displayedActions.length})`
                      : `Xuất Bulk File (${actions.length})`}
                  </span>
                </button>
              </div>
            </div>

            {/* SKU Groups & Targets Table (Tự động gom theo SKU) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-800">
                    ĐÃ GOM THEO SKU &amp; CHIẾN DỊCH ({skuGroups.length} SKU)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    (Click vào từng SKU và Chiến dịch để xem chi tiết các target)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 transition cursor-pointer"
                  >
                    Mở rộng tất cả
                  </button>
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 transition cursor-pointer"
                  >
                    Thu gọn tất cả
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white max-h-[52vh] shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/90 text-slate-600 sticky top-0 border-b border-slate-200 font-bold z-10 whitespace-nowrap">
                    <tr>
                      <th className="py-2.5 px-3 w-10"></th>
                      <th className="py-2.5 px-3 min-w-[160px]">SKU / Nhóm</th>
                      <th className="py-2.5 px-3 min-w-[320px] lg:min-w-[440px]">Chiến dịch</th>
                      <th className="py-2.5 px-3 min-w-[160px]">Mục tiêu (Targets)</th>
                      <th className="py-2.5 px-3 w-32">Hành động</th>
                      <th className="py-2.5 px-3 text-right w-24">Old (TB)</th>
                      <th className="py-2.5 px-3 text-right w-24">New (TB)</th>
                      <th className="py-2.5 px-3 text-center w-12">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {skuGroups.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400 font-medium">
                          {actions.length === 0
                            ? "Hàng đợi trống. Hãy duyệt đề xuất từ tab Đề xuất để thêm vào hàng đợi."
                            : `Không có hành động nào cho SKU "${selectedSkuFilter}".`}
                        </td>
                      </tr>
                    ) : (
                      skuGroups.map((group) => {
                        const isExpanded = expandedSkus.has(group.sku);
                        const isGroupAllSelected =
                          group.actions.length > 0 &&
                          group.actions.every((a) => selectedIds.has(a.id));
                        const isGroupPartiallySelected =
                          !isGroupAllSelected &&
                          group.actions.some((a) => selectedIds.has(a.id));

                        return (
                          <Fragment key={group.sku}>
                            {/* SKU Parent Header Row */}
                            <tr
                              className={`border-b border-slate-200 transition cursor-pointer ${
                                isExpanded
                                  ? "bg-indigo-50/60 font-bold"
                                  : isGroupAllSelected
                                  ? "bg-indigo-50/40 font-semibold"
                                  : "bg-slate-50/80 hover:bg-slate-100/70 font-semibold"
                              }`}
                            >
                              <td
                                className="py-2.5 px-3"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleToggleGroupSelect(group)}
                                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                  title={`Chọn tất cả ${group.totalActions} hành động của SKU ${group.sku}`}
                                >
                                  {isGroupAllSelected ? (
                                    <CheckSquare
                                      size={16}
                                      className="text-indigo-600"
                                      weight="fill"
                                    />
                                  ) : isGroupPartiallySelected ? (
                                    <div className="w-4 h-4 rounded border-2 border-indigo-600 bg-indigo-50 flex items-center justify-center">
                                      <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                                    </div>
                                  ) : (
                                    <Square size={16} />
                                  )}
                                </button>
                              </td>

                              <td
                                className="py-2.5 px-3"
                                onClick={() => handleToggleExpandSku(group.sku)}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="p-1 rounded text-slate-500 hover:text-slate-800">
                                    {isExpanded ? (
                                      <CaretDown size={14} weight="bold" />
                                    ) : (
                                      <CaretRight size={14} weight="bold" />
                                    )}
                                  </div>
                                  <span className="font-mono font-black text-indigo-800 text-sm">
                                    {group.sku}
                                  </span>
                                  {group.isZeroSpend ? (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap"
                                      title="SKU chưa cắn tiền (Spend = $0)"
                                    >
                                      0 spend
                                    </span>
                                  ) : (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 whitespace-nowrap"
                                      title="SKU đã cắn tiền"
                                    >
                                      spend &gt; 0
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td
                                className="py-2.5 px-3 text-slate-600 truncate max-w-[200px]"
                                onClick={() => handleToggleExpandSku(group.sku)}
                                title={group.campaigns.join(", ")}
                              >
                                {group.campaigns.length === 1
                                  ? group.campaigns[0]
                                  : `${group.campaigns.length} campaigns`}
                              </td>

                              <td
                                className="py-2.5 px-3"
                                onClick={() => handleToggleExpandSku(group.sku)}
                              >
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-black text-[11px]">
                                  {group.totalActions} targets
                                </span>
                              </td>

                              <td
                                className="py-2.5 px-3 whitespace-nowrap"
                                onClick={() => handleToggleExpandSku(group.sku)}
                              >
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {group.updateBidCount > 0 && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      {group.updateBidCount} Bid
                                    </span>
                                  )}
                                  {group.pauseCount > 0 && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                      {group.pauseCount} Pause
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td
                                className="py-2.5 px-3 text-right font-mono text-slate-500 text-xs"
                                onClick={() => handleToggleExpandSku(group.sku)}
                              >
                                {group.avgOldBid !== null ? `$${group.avgOldBid.toFixed(2)}` : "—"}
                              </td>

                              <td
                                className="py-2.5 px-3 text-right font-mono font-black text-indigo-700 text-sm"
                                onClick={() => handleToggleExpandSku(group.sku)}
                              >
                                {group.avgNewBid !== null ? `$${group.avgNewBid.toFixed(2)}` : "—"}
                              </td>

                              <td
                                className="py-2.5 px-3 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSkuGroup(group)}
                                  className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600 transition cursor-pointer"
                                  title={`Xóa tất cả ${group.totalActions} hành động của SKU ${group.sku}`}
                                >
                                  <Trash size={15} />
                                </button>
                              </td>
                            </tr>

                            {/* Expanded Campaign Subgroups & Individual Target Rows */}
                            {isExpanded &&
                              group.campaignGroups.map((camp) => {
                                const isCampExpanded = !collapsedCampaigns.has(
                                  `${group.sku}::${camp.campaignName}`
                                );
                                const isCampAllSelected =
                                  camp.actions.length > 0 &&
                                  camp.actions.every((a) => selectedIds.has(a.id));
                                const isCampPartiallySelected =
                                  !isCampAllSelected &&
                                  camp.actions.some((a) => selectedIds.has(a.id));

                                return (
                                  <Fragment key={`${group.sku}-${camp.campaignName}`}>
                                    {/* Campaign Sub-header Row */}
                                    <tr
                                      className="border-b border-slate-200/90 bg-slate-100/80 hover:bg-slate-200/70 transition cursor-pointer border-l-4 border-l-indigo-500 font-semibold"
                                      onClick={() =>
                                        handleToggleExpandCampaign(
                                          group.sku,
                                          camp.campaignName
                                        )
                                      }
                                    >
                                      <td
                                        className="py-2 px-3 pl-6"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleToggleCampaignSelect(camp)
                                          }
                                          className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                          title={`Chọn tất cả ${camp.totalActions} mục tiêu trong chiến dịch ${camp.campaignName}`}
                                        >
                                          {isCampAllSelected ? (
                                            <CheckSquare
                                              size={15}
                                              className="text-indigo-600"
                                              weight="fill"
                                            />
                                          ) : isCampPartiallySelected ? (
                                            <div className="w-3.5 h-3.5 rounded border-2 border-indigo-600 bg-indigo-50 flex items-center justify-center">
                                              <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                                            </div>
                                          ) : (
                                            <Square size={15} />
                                          )}
                                        </button>
                                      </td>

                                      {/* Campaign Name spanning columns 2 & 3 */}
                                      <td colSpan={2} className="py-2 px-3">
                                        <div className="flex items-center gap-2">
                                          <div className="p-0.5 rounded text-slate-500 hover:text-slate-800">
                                            {isCampExpanded ? (
                                              <CaretDown size={13} weight="bold" />
                                            ) : (
                                              <CaretRight size={13} weight="bold" />
                                            )}
                                          </div>
                                          <Megaphone
                                            size={13}
                                            className="text-indigo-600 shrink-0"
                                            weight="fill"
                                          />
                                          <span
                                            className="font-bold text-slate-800 text-xs select-all whitespace-normal break-words"
                                            title={camp.campaignName}
                                          >
                                            {camp.campaignName}
                                          </span>
                                        </div>
                                      </td>

                                      {/* Targets count in Campaign */}
                                      <td className="py-2 px-3">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-200/90 text-slate-700 font-bold text-[10px]">
                                          {camp.totalActions} targets
                                        </span>
                                      </td>

                                      {/* Action badges in Campaign */}
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {camp.updateBidCount > 0 && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                              {camp.updateBidCount} Bid
                                            </span>
                                          )}
                                          {camp.pauseCount > 0 && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                              {camp.pauseCount} Pause
                                            </span>
                                          )}
                                        </div>
                                      </td>

                                      {/* Old Avg Bid for Campaign */}
                                      <td className="py-2 px-3 text-right font-mono text-slate-500 text-[11px]">
                                        {camp.avgOldBid !== null
                                          ? `$${camp.avgOldBid.toFixed(2)}`
                                          : "—"}
                                      </td>

                                      {/* New Avg Bid for Campaign */}
                                      <td className="py-2 px-3 text-right font-mono font-bold text-indigo-700 text-xs">
                                        {camp.avgNewBid !== null
                                          ? `$${camp.avgNewBid.toFixed(2)}`
                                          : "—"}
                                      </td>

                                      {/* Delete Campaign */}
                                      <td
                                        className="py-2 px-3 text-center"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteCampaignGroup(camp)
                                          }
                                          className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600 transition cursor-pointer"
                                          title={`Xóa tất cả ${camp.totalActions} hành động trong chiến dịch ${camp.campaignName}`}
                                        >
                                          <Trash size={14} />
                                        </button>
                                      </td>
                                    </tr>

                                    {/* Individual Target Rows inside this Campaign */}
                                    {isCampExpanded &&
                                      camp.actions.map((act) => {
                                        const isSelected = selectedIds.has(act.id);
                                        return (
                                          <tr
                                            key={act.id}
                                            className={`border-b border-slate-100 transition ${
                                              isSelected
                                                ? "bg-indigo-50/40"
                                                : "bg-white hover:bg-slate-50"
                                            }`}
                                          >
                                            <td className="py-2 px-3 pl-10">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleToggleSelectOne(act.id)
                                                }
                                                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                              >
                                                {isSelected ? (
                                                  <CheckSquare
                                                    size={14}
                                                    className="text-indigo-600"
                                                    weight="fill"
                                                  />
                                                ) : (
                                                  <Square size={14} />
                                                )}
                                              </button>
                                            </td>

                                            <td className="py-2 px-3 pl-8 text-slate-500 text-[11px] font-mono">
                                              <div className="flex items-center gap-1.5">
                                                <span>↳ {act.matchType || "Keyword"}</span>
                                                {act.ruleVersion && (
                                                  <span className="px-1 py-0.2 rounded bg-slate-100 text-[9px] text-slate-400 font-sans">
                                                    {act.ruleVersion}
                                                  </span>
                                                )}
                                              </div>
                                            </td>

                                            <td
                                              className="py-2 px-3 text-slate-500 text-[11px] min-w-[240px] max-w-[440px] truncate"
                                              title={act.adGroupName || act.campaignName}
                                            >
                                              {act.adGroupName ? `Nhóm: ${act.adGroupName}` : act.campaignName}
                                            </td>

                                            <td
                                              className="py-2 px-3 font-bold text-slate-900 max-w-[200px] truncate"
                                              title={act.targetKeyword}
                                            >
                                              {act.targetKeyword}
                                            </td>

                                            <td className="py-2 px-3 whitespace-nowrap">
                                              {act.actionType === "PAUSE_TARGET" ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                                  <Pause size={11} weight="bold" /> Pause
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                  <ArrowUpRight size={11} weight="bold" /> Update Bid
                                                </span>
                                              )}
                                            </td>

                                            <td className="py-2 px-3 text-right font-mono text-slate-500 text-[11px]">
                                              {act.oldValue ? `$${act.oldValue.toFixed(2)}` : "—"}
                                            </td>

                                            <td className="py-2 px-3 text-right font-black text-indigo-700 font-mono text-xs">
                                              {act.actionType === "PAUSE_TARGET"
                                                ? "—"
                                                : `$${(act.finalValue || 0).toFixed(2)}`}
                                            </td>

                                            <td className="py-2 px-3 text-center">
                                              <button
                                                type="button"
                                                onClick={() => onRemoveAction(act.id)}
                                                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-rose-600 transition cursor-pointer"
                                                title="Xóa hành động này"
                                              >
                                                <Trash size={13} />
                                              </button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                  </Fragment>
                                );
                              })}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* History Section: Bulk Export vs Auto Upload AdsPower */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveHistoryTab("BULK")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      activeHistoryTab === "BULK"
                        ? "bg-white text-slate-800 shadow-xs border border-slate-200"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <ClockCounterClockwise size={14} weight="bold" />
                    <span>Lịch sử xuất Bulk ({bulkHistory.length})</span>
                  </button>

                  <button
                    onClick={() => setActiveHistoryTab("AUTO")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      activeHistoryTab === "AUTO"
                        ? "bg-amber-50 text-amber-900 shadow-xs border border-amber-200"
                        : "text-slate-500 hover:text-amber-700"
                    }`}
                  >
                    <Lightning size={14} weight="fill" className="text-amber-600" />
                    <span>Lịch sử Auto AdsPower ({autoLogs.length})</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onRefreshBulkHistory();
                    void loadAutoLogs();
                  }}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-[0.98] cursor-pointer"
                  title="Tải lại lịch sử"
                >
                  <ArrowsClockwise
                    size={14}
                    weight="bold"
                    className={isLoadingAutoLogs ? "animate-spin" : ""}
                  />
                </button>
              </div>

              <div className="max-h-52 overflow-y-auto">
                {activeHistoryTab === "BULK" ? (
                  bulkHistory.length === 0 ? (
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
                  )
                ) : autoLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">
                    Chưa có lượt Auto Upload AdsPower nào được ghi nhận.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {autoLogs.map((log) => (
                      <div key={log.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Lightning size={14} className="shrink-0 text-amber-600" weight="fill" />
                            <span className="truncate text-xs font-bold text-slate-800" title={log.fileName}>
                              {log.fileName}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                              {log.actionCount} actions
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                            <span>Profile: <strong>{log.adspowerProfileName || log.adspowerProfileId || storeName}</strong></span>
                            {log.durationMs > 0 && <span>• {(log.durationMs / 1000).toFixed(1)}s</span>}
                            {log.skus && log.skus.length > 0 && (
                              <span className="text-indigo-600 truncate max-w-[200px]" title={log.skus.join(", ")}>
                                SKUs: {log.skus.join(", ")}
                              </span>
                            )}
                          </div>
                          {log.errorMessage && (
                            <div className="text-[10px] text-rose-600 font-medium truncate" title={log.errorMessage}>
                              Lỗi: {log.errorMessage}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              log.status === "SUCCESS"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : log.status === "RUNNING"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            {log.status}
                          </span>
                          <time className="mt-1 block whitespace-nowrap text-[10px] text-slate-400">
                            {new Date(log.createdAt).toLocaleString("vi-VN")}
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

      {/* AUTO UPLOAD ADSPOWER MODAL */}
      {isAutoUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
                  <Lightning size={22} weight="fill" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase">
                    Auto Upload AdsPower
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Áp dụng riêng cho các SKU chưa cắn tiền (Zero Spend)
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isAutoUploading && setIsAutoUploadModalOpen(false)}
                disabled={isAutoUploading}
                className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-40 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scope / Protection Alert */}
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 space-y-1.5 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldCheck size={16} weight="fill" className="text-amber-700 shrink-0" />
                <span>Quy tắc bảo vệ dữ liệu</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Hệ thống sẽ <strong>chỉ xuất và upload các action thuộc SKU chưa cắn tiền</strong>. Các SKU đã cắn tiền sẽ được giữ an toàn trong Action Queue, không tự động upload nhầm.
              </p>
            </div>

            {/* SKU Target Selector inside Modal */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3 text-xs">
              <div className="flex justify-between items-center text-slate-700">
                <span className="font-bold">Chọn SKU thực thi:</span>
                <select
                  value={skuModalTarget}
                  onChange={(e) => setSkuModalTarget(e.target.value)}
                  className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-800 outline-none cursor-pointer text-xs"
                >
                  <option value="ALL">
                    Tất cả SKU chưa cắn tiền ({zeroSpendCandidateCount} actions)
                  </option>
                  {uniqueZeroSpendSkus.map((sku) => {
                    const count = zeroSpendCandidates.filter((a) => (a.sku || "").toUpperCase() === sku.toUpperCase()).length;
                    return (
                      <option key={sku} value={sku}>
                        Chỉ SKU {sku} ({count} actions)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex justify-between items-center text-slate-700">
                <span>Số lượng actions SKU chưa cắn tiền:</span>
                <strong className="text-amber-700 font-mono text-sm">
                  {modalZeroSpendCandidates.length} actions
                </strong>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>Gian hàng / Profile AdsPower:</span>
                <div className="flex items-center gap-1 font-bold text-slate-800">
                  <Browser size={14} className="text-sky-600" />
                  <span>{storeName || "HSOSTORE"}</span>
                </div>
              </div>

              {/* SKU Chips */}
              {uniqueZeroSpendSkus.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60">
                  <span className="text-[10px] text-slate-500 block mb-1 font-semibold uppercase">
                    Danh sách SKU thực thi:
                  </span>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {(skuModalTarget === "ALL" ? uniqueZeroSpendSkus : [skuModalTarget]).map((sku) => (
                      <span
                        key={sku}
                        className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] font-bold text-indigo-700 font-mono"
                      >
                        {sku}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Stepper / Progress Status when running */}
            {isAutoUploading && (
              <div className="bg-sky-50/60 border border-sky-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-900">
                  <SpinnerGap size={16} className="animate-spin text-sky-600" />
                  <span>Đang tự động thực thi quy trình RPA AdsPower...</span>
                </div>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 1 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 1 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>1. Lọc và chuẩn hóa {modalZeroSpendCandidates.length} action SKU chưa cắn tiền</span>
                  </div>
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 2 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 2 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>2. Xuất Amazon Bulk (.xlsx) & Kết nối CDP AdsPower</span>
                  </div>
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 3 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 3 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>3. Mở Bulk Operations & Upload campaigns</span>
                  </div>
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 4 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 4 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>4. Hoàn tất và lưu lịch sử thực thi</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {autoUploadError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <WarningCircle size={16} weight="fill" className="text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Không thể hoàn tất Auto Upload:</strong>
                  <p className="mt-0.5 text-rose-600">{autoUploadError}</p>
                </div>
              </div>
            )}

            {/* Success Display */}
            {autoUploadSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                <CheckCircle size={16} weight="fill" className="text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Thành công!</strong>
                  <p className="mt-0.5 text-emerald-700">{autoUploadSuccess}</p>
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                onClick={() => setIsAutoUploadModalOpen(false)}
                disabled={isAutoUploading}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition disabled:opacity-40 cursor-pointer"
              >
                {autoUploadSuccess ? "Đóng" : "Hủy"}
              </button>
              {!autoUploadSuccess && (
                <button
                  onClick={handleExecuteAutoUpload}
                  disabled={isAutoUploading || modalZeroSpendCandidates.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-black transition shadow-xs disabled:opacity-40 cursor-pointer"
                >
                  {isAutoUploading ? (
                    <>
                      <SpinnerGap size={15} className="animate-spin" />
                      <span>Đang xử lý AdsPower...</span>
                    </>
                  ) : (
                    <>
                      <Lightning size={15} weight="fill" />
                      <span>⚡ Bắt Đầu Auto Upload ({modalZeroSpendCandidates.length})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
