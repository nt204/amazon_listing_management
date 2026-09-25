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
  Copy,
  Eye,
  ArrowCounterClockwise,
  SlidersHorizontal,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import type { BulkExport, PpcAction, PpcAutoUploadLog } from "@/lib/ppc/sku-architecture-types";

export function formatCompactFileName(fileName: string, skus?: string[]) {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2})T(\d{2})[-:](\d{2})/);
  if (match) {
    const date = match[1];
    const time = `${match[2]}:${match[3]}`;
    const skuStr = skus && skus.length > 0 ? (skus.length <= 2 ? skus.join(", ") : `${skus[0]} +${skus.length - 1}`) : "";
    return {
      display: skuStr ? `${skuStr} · ${date} ${time}` : `${date} ${time}`,
      full: fileName,
    };
  }
  return {
    display: fileName.length > 34 ? fileName.slice(0, 18) + "..." + fileName.slice(-10) : fileName,
    full: fileName,
  };
}

export function getAutoUploadStatusMeta(status: string) {
  switch (status) {
    case "PENDING":
      return { label: "Đang chờ upload", color: "bg-blue-50 text-blue-700 border-blue-200" };
    case "RUNNING":
      return { label: "Đang thực thi", color: "bg-amber-50 text-amber-700 border-amber-200 animate-pulse" };
    case "RETRY_WAIT":
      return { label: "Đang chờ thử lại", color: "bg-amber-50 text-amber-800 border-amber-300" };
    case "SUCCESS":
      return { label: "Áp dụng thành công", color: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "PARTIAL_SUCCESS":
      return { label: "Thành công một phần", color: "bg-orange-50 text-orange-700 border-orange-200" };
    case "RESULT_TIMEOUT":
      return { label: "Không xác nhận được", color: "bg-amber-50 text-amber-900 border-amber-300" };
    case "FAILED":
      return { label: "Thất bại", color: "bg-rose-50 text-rose-700 border-rose-200" };
    case "CANCELLED":
      return { label: "Đã hủy", color: "bg-slate-100 text-slate-600 border-slate-200" };
    default:
      return { label: status, color: "bg-slate-100 text-slate-700 border-slate-200" };
  }
}

export function getFileCreationStatusMeta(status?: string) {
  switch (status) {
    case "FAILED":
      return { label: "Tạo file thất bại", color: "bg-rose-50 text-rose-700 border-rose-200", icon: WarningCircle };
    case "PENDING":
      return { label: "Đang tạo file", color: "bg-amber-50 text-amber-800 border-amber-200", icon: SpinnerGap };
    default:
      return { label: "Tạo file thành công", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle };
  }
}

export function getActionTypeBadge(actionType: string) {
  const norm = (actionType || "").toUpperCase();
  if (norm.includes("PAUSE")) {
    return {
      label: "Pause",
      className: "bg-amber-50 text-amber-800 border border-amber-200",
      icon: Pause,
    };
  }
  if (norm.includes("BUDGET")) {
    return {
      label: "Budget",
      className: "bg-purple-50 text-purple-700 border border-purple-200",
      icon: SlidersHorizontal,
    };
  }
  if (norm.includes("ENABLE") || norm.includes("UNPAUSE")) {
    return {
      label: "Bật",
      className: "bg-blue-50 text-blue-700 border border-blue-200",
      icon: Check,
    };
  }
  return {
    label: "Đổi Bid",
    className: "bg-slate-100 text-slate-700 border border-slate-200",
    icon: ArrowUpRight,
  };
}

export interface RunDetailItem {
  type: "BULK" | "AUTO";
  id: string;
  fileName: string;
  storeName?: string;
  profileName?: string;
  createdAt: string;
  status: string;
  actionCount: number;
  durationMs?: number;
  skus?: string[];
  errorMessage?: string | null;
  resultSummary?: string | null;
  bulkExportId?: string;
  rawLog?: PpcAutoUploadLog;
}

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
  const [autoLogs, setAutoLogs] = useState<PpcAutoUploadLog[]>([]);
  const [isLoadingAutoLogs, setIsLoadingAutoLogs] = useState(false);

  // Run Detail State (Slide-over drawer/modal)
  const [selectedRunDetail, setSelectedRunDetail] = useState<RunDetailItem | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailActionItems, setDetailActionItems] = useState<any[]>([]);
  const [detailSearchQuery, setDetailSearchQuery] = useState("");
  const [copiedFileNameId, setCopiedFileNameId] = useState<string | null>(null);

  // Safe Re-upload Modal State
  const [reuploadTarget, setReuploadTarget] = useState<PpcAutoUploadLog | null>(null);
  const [isReuploading, setIsReuploading] = useState(false);

  // Cancelling Task State
  const [isCancellingTaskId, setIsCancellingTaskId] = useState<string | null>(null);

  // Keyboard shortcut: ESC to close modal or drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (reuploadTarget) {
          if (!isReuploading) setReuploadTarget(null);
        } else if (selectedRunDetail) {
          setSelectedRunDetail(null);
        } else if (isAutoUploadModalOpen) {
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
  }, [isOpen, isAutoUploadModalOpen, isExportWizardOpen, isAutoUploading, selectedRunDetail, reuploadTarget, isReuploading, onClose]);

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

  const hasActiveAutoUpload = autoLogs.some((log) =>
    ["PENDING", "RUNNING", "RETRY_WAIT"].includes(log.status),
  );

  useEffect(() => {
    if (!isOpen || !hasActiveAutoUpload) return;
    const timer = window.setInterval(() => void loadAutoLogs(), 3_000);
    return () => window.clearInterval(timer);
  }, [isOpen, hasActiveAutoUpload, loadAutoLogs]);

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

  // Copy File Name helper
  const handleCopyFileName = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFileNameId(id);
    setTimeout(() => setCopiedFileNameId(null), 1800);
  };

  // Download Bulk Export .xlsx helper
  const handleDownloadXlsx = async (exportId: string, fileName: string) => {
    try {
      const res = await fetch(`/api/ppc/bulk-export?downloadId=${encodeURIComponent(exportId)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Không thể tải file");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Lỗi tải file: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Open Detail Drawer for a run
  const handleOpenRunDetail = async (run: RunDetailItem) => {
    setSelectedRunDetail(run);
    setIsLoadingDetail(true);
    setDetailActionItems([]);
    setDetailSearchQuery("");
    try {
      if (run.type === "BULK") {
        const res = await fetch(`/api/ppc/bulk-export?id=${encodeURIComponent(run.id)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.data?.items) {
            setDetailActionItems(json.data.items);
          }
        }
      } else {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(run.id)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.data?.actions) {
            setDetailActionItems(json.data.actions);
          }
          if (json.data?.log) {
            setSelectedRunDetail((prev) => (prev ? { ...prev, rawLog: json.data.log } : null));
          }
        }
      }
    } catch (err) {
      console.error("Lỗi khi tải chi tiết run:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Safe Re-upload Execution
  const handleConfirmReupload = async () => {
    if (!reuploadTarget) return;
    try {
      setIsReuploading(true);
      const actionIds = Array.isArray((reuploadTarget as any).actionIds) && (reuploadTarget as any).actionIds.length > 0
        ? (reuploadTarget as any).actionIds
        : (detailActionItems.length > 0 ? detailActionItems.map((a) => a.id) : undefined);

      const res = await fetch("/api/ppc/auto-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: reuploadTarget.storeId || storeId,
          actionIds,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Lỗi khi xếp hàng upload lại");
      }
      setReuploadTarget(null);
      setSelectedRunDetail(null);
      void loadAutoLogs();
      alert(`Đã xếp hàng upload lại thành công: ${json.message || ""}`);
    } catch (err) {
      alert("Lỗi upload lại: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsReuploading(false);
    }
  };

  // Cancel Pending Upload Task
  const handleCancelPendingTask = async (logId: string) => {
    if (!confirm("Bạn có chắc chắn muốn hủy tác vụ upload đang chờ này?")) return;
    try {
      setIsCancellingTaskId(logId);
      const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(logId)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Không thể hủy tác vụ");
      }
      void loadAutoLogs();
      if (selectedRunDetail?.id === logId) {
        setSelectedRunDetail((prev) => (prev ? { ...prev, status: "CANCELLED" } : null));
      }
    } catch (err) {
      alert("Lỗi khi hủy: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsCancellingTaskId(null);
    }
  };

  // Filtered detail actions
  const filteredDetailActions = useMemo(() => {
    if (!detailSearchQuery.trim()) return detailActionItems;
    const q = detailSearchQuery.toLowerCase();
    return detailActionItems.filter((item) =>
      (item.sku || "").toLowerCase().includes(q) ||
      (item.targetKeyword || "").toLowerCase().includes(q) ||
      (item.campaignName || "").toLowerCase().includes(q) ||
      (item.adGroupName || "").toLowerCase().includes(q) ||
      (item.actionType || "").toLowerCase().includes(q)
    );
  }, [detailActionItems, detailSearchQuery]);

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

      setAutoUploadStep(3);
      setAutoUploadSuccess(
        data.message || `Đã tạo file Bulk và xếp hàng upload lên Mac mini cho ${modalZeroSpendCandidates.length} actions.`
      );

      void loadAutoLogs();
      onRefreshBulkHistory();
      if (onRefreshActionQueue) {
        onRefreshActionQueue();
      }
    } catch (err: any) {
      setAutoUploadError(err?.message || String(err));
      void loadAutoLogs();
      onRefreshBulkHistory();
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
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
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
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
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
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                  <ArrowUpRight size={11} weight="bold" /> Đổi Bid
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

            {/* Execution history */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 bg-slate-50/50">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Lightning size={14} weight="fill" className="text-amber-600" />
                  <span>Kết quả thực thi ({autoLogs.length})</span>
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

              <div className="max-h-64 overflow-y-auto">
                {autoLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">
                    Chưa có lượt Auto Upload AdsPower nào được ghi nhận.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {autoLogs.map((log) => {
                      const statusMeta = getAutoUploadStatusMeta(log.status);
                      const matchedBulk = bulkHistory.find((b) => b.fileName === log.fileName);
                      const canReupload = log.fileStatus !== "FAILED" && ["FAILED", "PARTIAL_SUCCESS", "RESULT_TIMEOUT"].includes(log.status);
                      const isPending = log.status === "PENDING";
                      const fileStatusMeta = getFileCreationStatusMeta(log.fileStatus);
                      const FileStatusIcon = fileStatusMeta.icon;
                      const uploadNotStarted = log.fileStatus !== "SUCCESS" || log.stage === "FILE_GENERATION_FAILED";

                      return (
                        <div
                          key={log.id}
                          className="flex flex-col gap-2 px-3.5 py-2.5 hover:bg-slate-50 transition"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-1.5">
                                <Lightning size={15} className="shrink-0 text-amber-600" weight="fill" />
                                <span
                                  className="min-w-0 text-xs font-bold leading-5 text-slate-800 [overflow-wrap:anywhere]"
                                  title={log.fileName || "File chưa được tạo"}
                                >
                                  {log.fileName || "File chưa được tạo"}
                                </span>
                                {log.fileName && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyFileName(log.fileName, log.id)}
                                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                                    title="Sao chép tên file"
                                  >
                                    {copiedFileNameId === log.id ? (
                                      <Check size={12} className="text-emerald-600 font-bold" />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                  </button>
                                )}
                                <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-semibold">
                                  {log.actionCount} actions
                                </span>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
                                <span>
                                  Profile:{" "}
                                  <strong className="text-slate-700">
                                    {log.adspowerProfileName || log.adspowerProfileId || storeName}
                                  </strong>
                                </span>
                                {log.durationMs > 0 && <span>• {(log.durationMs / 1000).toFixed(1)}s</span>}
                                {log.skus && log.skus.length > 0 && (
                                  <span className="text-indigo-600 truncate max-w-[200px]" title={log.skus.join(", ")}>
                                    • SKUs: {log.skus.join(", ")}
                                  </span>
                                )}
                                <span className="text-slate-400">•</span>
                                <time className="text-slate-400">
                                  {new Date(log.createdAt).toLocaleString("vi-VN")}
                                </time>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenRunDetail({
                                    type: "AUTO",
                                    id: log.id,
                                    fileName: log.fileName,
                                    createdAt: log.createdAt,
                                    status: log.status,
                                    actionCount: log.actionCount,
                                    durationMs: log.durationMs,
                                    skus: log.skus,
                                    profileName: log.adspowerProfileName || log.adspowerProfileId || storeName,
                                    storeName,
                                    errorMessage: log.errorMessage,
                                    resultSummary: log.resultSummary,
                                    bulkExportId: matchedBulk?.id,
                                    rawLog: log,
                                  })
                                }
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                              >
                                <Eye size={13} weight="bold" />
                                <span>Chi tiết</span>
                              </button>

                              {isPending && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelPendingTask(log.id)}
                                  disabled={isCancellingTaskId === log.id}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 transition cursor-pointer"
                                  title="Hủy tác vụ đang chờ"
                                >
                                  <X size={13} weight="bold" />
                                  <span>{isCancellingTaskId === log.id ? "Đang hủy..." : "Hủy"}</span>
                                </button>
                              )}

                              {canReupload && (
                                <button
                                  type="button"
                                  onClick={() => setReuploadTarget(log)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition cursor-pointer"
                                  title="Upload lại lượt thất bại này"
                                >
                                  <ArrowCounterClockwise size={13} weight="bold" />
                                  <span>Upload lại</span>
                                </button>
                              )}

                              {matchedBulk && (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadXlsx(matchedBulk.id, log.fileName)}
                                  className="p-1 rounded text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                                  title="Tải file .xlsx tương ứng"
                                >
                                  <DownloadSimple size={14} weight="bold" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid gap-1.5 sm:grid-cols-2">
                            <div className={`flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 ${fileStatusMeta.color}`}>
                              <FileStatusIcon
                                size={15}
                                weight="bold"
                                className={`mt-0.5 shrink-0 ${log.fileStatus === "PENDING" ? "animate-spin" : ""}`}
                              />
                              <div className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">Tạo file</div>
                                <div className="text-[11px] font-bold">{fileStatusMeta.label}</div>
                                {log.fileErrorMessage && (
                                  <div className="mt-0.5 text-[10px] leading-4 [overflow-wrap:anywhere]">{log.fileErrorMessage}</div>
                                )}
                              </div>
                            </div>

                            <div className={`flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 ${uploadNotStarted ? "border-slate-200 bg-slate-50 text-slate-500" : statusMeta.color}`}>
                              {uploadNotStarted ? (
                                <Clock size={15} weight="bold" className="mt-0.5 shrink-0" />
                              ) : log.status === "SUCCESS" ? (
                                <CheckCircle size={15} weight="bold" className="mt-0.5 shrink-0" />
                              ) : log.status === "FAILED" ? (
                                <WarningCircle size={15} weight="bold" className="mt-0.5 shrink-0" />
                              ) : (
                                <SpinnerGap size={15} weight="bold" className="mt-0.5 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">Upload Amazon</div>
                                <div className="text-[11px] font-bold">
                                  {uploadNotStarted
                                    ? log.fileStatus === "FAILED"
                                      ? "Chưa chạy do lỗi tạo file"
                                      : "Chưa chạy, đang chờ tạo file"
                                    : statusMeta.label}
                                </div>
                                {log.errorMessage && !uploadNotStarted && (
                                  <div className="mt-0.5 text-[10px] leading-4 [overflow-wrap:anywhere]">{log.errorMessage}</div>
                                )}
                                {log.resultSummary && !log.errorMessage && (
                                  <div className="mt-0.5 text-[10px] leading-4 [overflow-wrap:anywhere]">{log.resultSummary}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
                <span>Store / Profile AdsPower:</span>
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
              <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-sky-900">
                  <SpinnerGap size={16} className="animate-spin text-sky-600" />
                  <span>Đang tạo file Bulk và gửi vào hàng đợi Mac mini...</span>
                </div>
                <div className="space-y-1.5 text-xs text-slate-600 pl-1">
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 1 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 1 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>1. Lọc {modalZeroSpendCandidates.length} actions SKU chưa cắn tiền</span>
                  </div>
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 2 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 2 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>2. Xuất file Amazon Bulksheet (.xlsx) chuẩn mẫu</span>
                  </div>
                  <div className={`flex items-center gap-2 ${autoUploadStep >= 3 ? "text-emerald-700 font-bold" : "text-slate-400"}`}>
                    {autoUploadStep >= 3 ? <Check size={14} weight="bold" /> : <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />}
                    <span>3. Đẩy lên Cloudflare R2 & xếp hàng cho Mac mini AdsPower</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {autoUploadError && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5">
                <WarningCircle size={18} weight="fill" className="text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Không thể xếp hàng Auto Upload:</strong>
                  <p className="mt-0.5 text-rose-600">{autoUploadError}</p>
                </div>
              </div>
            )}

            {/* Queued / Success Display */}
            {autoUploadSuccess && (
              <div className="p-4 bg-sky-50/80 border border-sky-200 rounded-xl text-xs text-sky-950 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sky-900">
                  <CheckCircle size={18} weight="fill" className="text-sky-600 shrink-0" />
                  <span>Đã xếp hàng upload lên Mac mini thành công!</span>
                </div>
                <p className="text-[11px] text-sky-800 leading-relaxed">
                  File Bulk đã được tạo và gửi vào hàng đợi. Mac mini đang kết nối AdsPower để đẩy file lên Amazon Ads.
                </p>
                <div className="pt-1 flex items-center gap-1.5 text-[11px] text-sky-900 font-bold">
                  <span>👉 Vui lòng xem tiến độ thực tế tại tab</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAutoUploadModalOpen(false);
                    }}
                    className="underline text-indigo-700 hover:text-indigo-900 cursor-pointer"
                  >
                    "Kết quả thực thi"
                  </button>
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
              {autoUploadSuccess ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoUploadModalOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  <Eye size={14} weight="bold" />
                  <span>Xem kết quả thực thi</span>
                </button>
              ) : (
                <button
                  onClick={handleExecuteAutoUpload}
                  disabled={isAutoUploading || modalZeroSpendCandidates.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-black transition shadow-xs disabled:opacity-40 cursor-pointer"
                >
                  {isAutoUploading ? (
                    <>
                      <SpinnerGap size={15} className="animate-spin" />
                      <span>Đang xếp hàng...</span>
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

      {/* RUN DETAIL SLIDE-OVER / MODAL */}
      {selectedRunDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 bg-slate-50/70">
              <div className="space-y-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      selectedRunDetail.type === "BULK"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : getAutoUploadStatusMeta(selectedRunDetail.status).color
                    }`}
                  >
                    {selectedRunDetail.type === "BULK"
                      ? "Đã xuất file"
                      : getAutoUploadStatusMeta(selectedRunDetail.status).label}
                  </span>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {selectedRunDetail.type === "BULK" ? "Bulk Export" : "Auto Upload AdsPower"}
                  </span>
                  {selectedRunDetail.durationMs && selectedRunDetail.durationMs > 0 ? (
                    <span className="text-xs text-slate-400">
                      • Thời lượng: {(selectedRunDetail.durationMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <h3
                    className="text-sm sm:text-base font-extrabold text-slate-900 truncate"
                    title={selectedRunDetail.fileName}
                  >
                    {selectedRunDetail.fileName}
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleCopyFileName(selectedRunDetail.fileName, "detail-title")}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
                    title="Sao chép tên file"
                  >
                    {copiedFileNameId === "detail-title" ? (
                      <Check size={14} className="text-emerald-600 font-bold" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span>Store: <strong>{selectedRunDetail.storeName || storeName}</strong></span>
                  {selectedRunDetail.profileName && (
                    <span>• Profile AdsPower: <strong>{selectedRunDetail.profileName}</strong></span>
                  )}
                  <span>• Thời gian: {new Date(selectedRunDetail.createdAt).toLocaleString("vi-VN")}</span>
                  <span>• <strong>{selectedRunDetail.actionCount}</strong> hành động</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRunDetail(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Error Alert if any */}
              {selectedRunDetail.errorMessage && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
                  <WarningCircle size={18} weight="fill" className="text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <strong className="text-rose-900 font-bold">Lỗi trong quá trình upload:</strong>
                    <p className="text-rose-700 leading-relaxed font-mono text-[11px]">
                      {selectedRunDetail.errorMessage}
                    </p>
                  </div>
                </div>
              )}

              {/* Amazon Result Summary if any */}
              {selectedRunDetail.resultSummary && (
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
                  <CheckCircle size={18} weight="fill" className="text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <strong className="text-emerald-950 font-bold">Phản hồi từ Amazon:</strong>
                    <p className="text-emerald-800 leading-relaxed font-mono text-[11px]">
                      {selectedRunDetail.resultSummary}
                    </p>
                  </div>
                </div>
              )}

              {/* Toolbar: Search & Action Breakdown */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="relative flex-1 max-w-sm">
                  <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={detailSearchQuery}
                    onChange={(e) => setDetailSearchQuery(e.target.value)}
                    placeholder="Lọc theo SKU, Keyword, Campaign..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-indigo-500 outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Hiển thị <strong>{filteredDetailActions.length}</strong> / {detailActionItems.length} actions</span>
                </div>
              </div>

              {/* Table of Actions */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                {isLoadingDetail ? (
                  <div className="py-16 text-center text-slate-400 space-y-2">
                    <SpinnerGap size={24} className="animate-spin mx-auto text-indigo-600" />
                    <p className="text-xs">Đang tải danh sách hành động...</p>
                  </div>
                ) : filteredDetailActions.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    {detailSearchQuery ? "Không tìm thấy hành động phù hợp." : "Chưa có danh sách chi tiết cho đợt này."}
                  </div>
                ) : (
                  <div className="max-h-[380px] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider z-10">
                        <tr>
                          <th className="py-2.5 px-3">SKU</th>
                          <th className="py-2.5 px-3">Campaign / Ad Group</th>
                          <th className="py-2.5 px-3">Target Keyword</th>
                          <th className="py-2.5 px-3">Thao tác</th>
                          <th className="py-2.5 px-3 text-right">Thay đổi</th>
                          <th className="py-2.5 px-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredDetailActions.map((act, idx) => {
                          const badge = getActionTypeBadge(act.actionType);
                          const Icon = badge.icon;
                          const isPause = (act.actionType || "").toUpperCase().includes("PAUSE");

                          return (
                            <tr key={act.id || idx} className="hover:bg-slate-50/80 transition">
                              <td className="py-2.5 px-3 font-bold text-slate-900 font-mono text-xs whitespace-nowrap">
                                {act.sku || "—"}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 max-w-[220px]">
                                <div className="truncate font-medium text-slate-800" title={act.campaignName}>
                                  {act.campaignName || "—"}
                                </div>
                                {act.adGroupName && (
                                  <div className="truncate text-[10px] text-slate-400 mt-0.5" title={act.adGroupName}>
                                    Nhóm: {act.adGroupName}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 max-w-[200px]">
                                <div className="truncate font-semibold text-slate-900" title={act.targetKeyword}>
                                  {act.targetKeyword || "—"}
                                </div>
                                {act.matchType && (
                                  <span className="inline-block mt-0.5 text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                                    {act.matchType}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${badge.className}`}
                                >
                                  <Icon size={12} weight="bold" />
                                  <span>{badge.label}</span>
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono text-xs">
                                {isPause ? (
                                  <span className="text-amber-700 font-semibold text-[11px]">Bật → Tạm dừng</span>
                                ) : (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <span className="text-slate-400 line-through text-[11px]">
                                      {act.oldValue !== null && act.oldValue !== undefined
                                        ? `$${Number(act.oldValue).toFixed(2)}`
                                        : "—"}
                                    </span>
                                    <span className="text-slate-400">→</span>
                                    <span className="font-extrabold text-indigo-700">
                                      {act.finalValue !== null && act.finalValue !== undefined
                                        ? `$${Number(act.finalValue).toFixed(2)}`
                                        : "—"}
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    act.status === "APPLIED" || act.status === "SUCCESS"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : act.status === "PENDING"
                                      ? "bg-blue-50 text-blue-700"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {act.status === "APPLIED" || act.status === "SUCCESS"
                                    ? "Đã áp dụng"
                                    : act.status === "PENDING"
                                    ? "Chờ xử lý"
                                    : act.status || "Hoàn tất"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3.5 bg-slate-50/50">
              <div className="flex items-center gap-2">
                {selectedRunDetail.type === "BULK" && (
                  <button
                    type="button"
                    onClick={() => handleDownloadXlsx(selectedRunDetail.id, selectedRunDetail.fileName)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <DownloadSimple size={14} weight="bold" />
                    <span>Tải file Excel (.xlsx)</span>
                  </button>
                )}

                {selectedRunDetail.type === "AUTO" && selectedRunDetail.bulkExportId && (
                  <button
                    type="button"
                    onClick={() => handleDownloadXlsx(selectedRunDetail.bulkExportId!, selectedRunDetail.fileName)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <DownloadSimple size={14} weight="bold" />
                    <span>Tải file .xlsx tương ứng</span>
                  </button>
                )}

                {selectedRunDetail.type === "AUTO" &&
                  ["FAILED", "PARTIAL_SUCCESS", "RESULT_TIMEOUT"].includes(selectedRunDetail.status) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedRunDetail.rawLog) {
                          setReuploadTarget(selectedRunDetail.rawLog);
                        } else {
                          setReuploadTarget({
                            id: selectedRunDetail.id,
                            storeId: storeId || "",
                            fileName: selectedRunDetail.fileName,
                            adspowerProfileId: null,
                            adspowerProfileName: selectedRunDetail.profileName || null,
                            actionCount: selectedRunDetail.actionCount,
                            skus: selectedRunDetail.skus || [],
                            status: selectedRunDetail.status as any,
                            errorMessage: selectedRunDetail.errorMessage || null,
                            durationMs: selectedRunDetail.durationMs || 0,
                            createdAt: selectedRunDetail.createdAt,
                          });
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                    >
                      <ArrowCounterClockwise size={14} weight="bold" />
                      <span>Upload lại lên Amazon</span>
                    </button>
                  )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedRunDetail(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAFE RE-UPLOAD CONFIRMATION MODAL */}
      {reuploadTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
                  <ShieldCheck size={22} weight="fill" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Xác nhận Upload lại lên Amazon
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Profile AdsPower: {reuploadTarget.adspowerProfileName || storeName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isReuploading && setReuploadTarget(null)}
                disabled={isReuploading}
                className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-40 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 space-y-2 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold">
                <WarningCircle size={16} weight="fill" className="text-amber-700 shrink-0" />
                <span>Cảnh báo an toàn thao tác</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Bạn sắp gửi lệnh thực thi lại <strong>{reuploadTarget.actionCount} hành động</strong> thuộc SKU{" "}
                <strong>{reuploadTarget.skus?.join(", ") || "Zero Spend"}</strong> lên Amazon Ads.
              </p>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Hãy chắc chắn rằng đợt thực thi trước đó <strong>chưa được áp dụng</strong> trên Amazon Ads Console để tránh việc thay đổi Bid hoặc Pause bị lặp lại.
              </p>
            </div>

            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600">
                <span>Tên file:</span>
                <span className="font-mono font-bold text-slate-800 truncate max-w-[220px]" title={reuploadTarget.fileName}>
                  {reuploadTarget.fileName}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Số lượng hành động:</span>
                <strong className="text-amber-700 font-mono">{reuploadTarget.actionCount} actions</strong>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>SKUs:</span>
                <strong className="text-indigo-700">{reuploadTarget.skus?.join(", ") || "—"}</strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReuploadTarget(null)}
                disabled={isReuploading}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold transition disabled:opacity-40 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmReupload}
                disabled={isReuploading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition shadow-xs disabled:opacity-40 cursor-pointer"
              >
                {isReuploading ? (
                  <>
                    <SpinnerGap size={15} className="animate-spin" />
                    <span>Đang xếp hàng...</span>
                  </>
                ) : (
                  <>
                    <ArrowCounterClockwise size={15} weight="bold" />
                    <span>Xác nhận Upload lại</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
