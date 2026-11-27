"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { X, CircleNotch, CaretDown, Download } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";
import {
  LAUNCH_BIDDING_STRATEGIES,
  LAUNCH_MATCH_TYPES,
  LAUNCH_RUN_TYPES,
  buildMultiLaunchPlan,
  DEFAULT_RUN_BID_PCT,
  countLaunchTargets,
  isTermUsableForRunType,
  kwPlusVariant,
  launchRunType,
  type LaunchBiddingStrategy,
  type LaunchFulfillment,
  type LaunchMatchType,
  type LaunchRunType,
  type LaunchSkuOverride,
  type LaunchCampaign,
  type LaunchRunConfig,
  type LaunchTrangThai,
} from "@/lib/ppc/campaign-launch";
import {
  isAsinProductTarget,
  formatYYYYMMDD,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";
import { SB_FIELD_LABELS, SB_FIELD_PLACEHOLDERS, missingSbFields, withStoreSbDefaults, type SbField, type SbOverrides, type StoreSbDefaults } from "@/lib/ppc/new-camp-fields";
import type { NewCampSkuInfo } from "@/lib/ppc/new-camp-generator";

type BidRule = "cpc" | "cpc_pct";
const UNKNOWN_SKU = "UNKNOWN_SKU";

interface RunSetting {
  matchTypes: Record<LaunchMatchType, boolean>;
  dailyBudget: number;
  bidPct: number;
}

interface LaunchSettings {
  /** Nhiều dạng chạy cùng lúc, mỗi dạng 1 cài đặt (match type, budget, % bid) */
  runTypes: LaunchRunType[];
  runSettings: Record<LaunchRunType, RunSetting>;
  biddingStrategy: LaunchBiddingStrategy;
  bidRule: BidRule;
  bidValue: number;
  suffix: string;
  fulfillment: LaunchFulfillment;
  trangThai: LaunchTrangThai;
}

function defaultRunSettings(): Record<LaunchRunType, RunSetting> {
  return Object.fromEntries(
    LAUNCH_RUN_TYPES.map((t) => [t.value, { matchTypes: { exact: true, phrase: true, broad: true }, dailyBudget: 5, bidPct: DEFAULT_RUN_BID_PCT[t.value] }]),
  ) as Record<LaunchRunType, RunSetting>;
}

const DEFAULT_SETTINGS: LaunchSettings = {
  runTypes: ["SP03"],
  runSettings: defaultRunSettings(),
  biddingStrategy: "Dynamic bids - down only",
  bidRule: "cpc",
  bidValue: 10,
  suffix: "",
  fulfillment: "FBA",
  trangThai: "Auto",
};
const TRANG_THAI_OPTIONS: Array<{ value: LaunchTrangThai; label: string }> = [
  { value: "Auto", label: "Auto (theo BẢNG MÃ)" },
  { value: "Test", label: "Test" },
  { value: "Win", label: "Win" },
];

interface LaunchItem {
  id: string;
  term: string;
  isAsin: boolean;
  sku: string;
  clicks: number;
  spend: number;
  orders: number;
  cpc: number;
  bidOverride: number | null;
}

// Dòng nguồn: search term hoặc target (term = targetKeyword)
export interface LaunchSourceRow {
  customerSearchTerm: string;
  campaignName: string;
  adGroupName?: string;
  portfolioName?: string;
  sku?: string;
  clicks: number;
  spend: number;
  orders: number;
  reportDate?: string;
  reportEndDate?: string;
  /** Dòng tổng ở bảng tóm tắt: đã cộng mọi campaign, ưu tiên hơn dòng chi tiết cùng term */
  grouped?: boolean;
}

interface Props {
  selectedRows: LaunchSourceRow[];
  storeName: string;
  storeId?: string;
  selectedSku: string;
  knownSkus: string[];
  actor?: RequestActor;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onClear: () => void;
  onLaunched: () => void;
}

function actorStorageId(actor?: RequestActor): string {
  return (actor?.userId || actor?.displayName || "default").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultUserName(actor?: RequestActor): string {
  const raw = actor?.displayName?.trim();
  if (!raw) return "Loan";
  const part = raw.includes("@")
    ? raw.split("@")[0].replace(/[^a-zA-Z0-9]/g, "")
    : raw.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/)[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : "Loan";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function readSavedSettings(settingsKey: string): LaunchSettings | null {
  try {
    const saved = localStorage.getItem(settingsKey);
    if (!saved) return null;
    const raw = JSON.parse(saved);
    const parsedSettings = { ...DEFAULT_SETTINGS, ...raw };
    // Cài đặt cũ (1 dạng chạy): runType / matchTypes / dailyBudget
    const validRun = (v: unknown): v is LaunchRunType => LAUNCH_RUN_TYPES.some((t) => t.value === v);
    parsedSettings.runTypes = Array.isArray(raw.runTypes) ? raw.runTypes.filter(validRun) : validRun(raw.runType) ? [raw.runType] : ["SP03"];
    const runSettings = defaultRunSettings();
    for (const t of LAUNCH_RUN_TYPES) {
      const savedRun = raw.runSettings?.[t.value];
      if (savedRun) runSettings[t.value] = { ...runSettings[t.value], ...savedRun };
      else if (raw.matchTypes || raw.dailyBudget) {
        runSettings[t.value] = { ...runSettings[t.value], ...(raw.matchTypes ? { matchTypes: raw.matchTypes } : {}), ...(Number(raw.dailyBudget) > 0 ? { dailyBudget: Number(raw.dailyBudget) } : {}) };
      }
    }
    parsedSettings.runSettings = runSettings;
    delete parsedSettings.runType;
    delete parsedSettings.matchTypes;
    delete parsedSettings.dailyBudget;
    if (parsedSettings.bidRule !== "cpc_pct") parsedSettings.bidRule = "cpc";
    if (parsedSettings.fulfillment !== "FBM") parsedSettings.fulfillment = "FBA";
    if (!["Auto", "Test", "Win"].includes(parsedSettings.trangThai)) parsedSettings.trangThai = "Auto";
    return parsedSettings;
  } catch {
    return null;
  }
}

// "+10", "-5", "10" → số %; nhập dở ("-", "+") coi là 0
function parsePct(value: string): number {
  const num = Number(value.replace(/^\+/, ""));
  return Number.isFinite(num) ? num : 0;
}

function formatPct(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function computeBid(item: LaunchItem, settings: LaunchSettings): number {
  if (item.bidOverride && item.bidOverride > 0) return item.bidOverride;
  if (item.cpc <= 0) return 1;
  if (settings.bidRule === "cpc_pct") return Math.max(0.1, round2(item.cpc * (1 + (settings.bidValue || 0) / 100)));
  return Math.max(0.1, item.cpc);
}

// Gộp các dòng đã chọn theo (SKU, term)
function buildItems(rows: LaunchSourceRow[], selectedSku: string): LaunchItem[] {
  const map = new Map<string, LaunchItem>();
  const groupedIds = new Set<string>();
  const ordered = [...rows].sort((a, b) => Number(Boolean(b.grouped)) - Number(Boolean(a.grouped)));
  for (const row of ordered) {
    const term = (row.customerSearchTerm || "").trim();
    if (!term) continue;
    if (row.grouped) groupedIds.add(term.toLowerCase());
    else if (groupedIds.has(term.toLowerCase())) continue;
    const sku = resolveSkuForSearchTerm(row, selectedSku);
    const id = `${sku.toLowerCase()}|||${term.toLowerCase()}`;
    const existing = map.get(id);
    if (existing) {
      existing.clicks += Number(row.clicks) || 0;
      existing.spend += Number(row.spend) || 0;
      existing.orders += Number(row.orders) || 0;
      continue;
    }
    map.set(id, {
      id,
      term,
      isAsin: isAsinProductTarget(term),
      sku,
      clicks: Number(row.clicks) || 0,
      spend: Number(row.spend) || 0,
      orders: Number(row.orders) || 0,
      cpc: 0,
      bidOverride: null,
    });
  }
  const items = Array.from(map.values());
  for (const item of items) item.cpc = item.clicks > 0 ? round2(item.spend / item.clicks) : 0;
  return items;
}

export function PpcSearchTermLaunchPanel({
  selectedRows,
  storeName,
  storeId,
  selectedSku,
  knownSkus,
  actor,
  notify,
  onClear,
  onLaunched,
}: Props) {
  const storageId = actorStorageId(actor);
  const settingsKey = `ppc_campaign_launch_settings_${storageId}`;
  const userNameKey = `ppc_sale_kw_username_${storageId}`;

  const [open, setOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportBidPct, setExportBidPct] = useState("0");
  const [settings, setSettings] = useState<LaunchSettings>(DEFAULT_SETTINGS);
  const [userName, setUserName] = useState(() => defaultUserName(actor));
  const [dateStr, setDateStr] = useState(() => formatYYYYMMDD());
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [commonBid, setCommonBid] = useState("");
  const [kwPlus, setKwPlus] = useState(false);
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [skuOverrides, setSkuOverrides] = useState<Record<string, LaunchSkuOverride>>({});
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"export" | "upload" | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ jobId: string; status: string; progress?: number; error?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sbInfos, setSbInfos] = useState<{ type: LaunchFulfillment; store: string; map: Map<string, NewCampSkuInfo>; storeDefaults: StoreSbDefaults | null } | null>(null);
  const [sbOverrides, setSbOverrides] = useState<SbOverrides>({});

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const updateSettings = (patch: Partial<LaunchSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(settingsKey, JSON.stringify(next));
      } catch { }
      return next;
    });
  };

  const updateUserName = (value: string) => {
    setUserName(value);
    try {
      localStorage.setItem(userNameKey, value);
    } catch { }
  };

  const openPanel = () => {
    const savedSettings = readSavedSettings(settingsKey);
    if (savedSettings) setSettings(savedSettings);
    try {
      const savedName = localStorage.getItem(userNameKey);
      if (savedName?.trim()) setUserName(savedName.trim());
    } catch { }
    setItems(buildItems(selectedRows, selectedSku));
    setCommonBid("");
    setKwPlus(false);
    setNameEdits({});
    setEditingName(null);
    setSkuOverrides({});
    setExpandedSkus(new Set());
    setUploadStatus(null);
    setSbInfos(null);
    setSbOverrides({});
    // Mỗi lần mở: ngày trong tên campaign mặc định là hôm nay (giờ VN), sửa được.
    setDateStr(formatYYYYMMDD());
    setOpen(true);
  };

  const bidFor = (item: LaunchItem): number => computeBid(item, settings);

  const openExportMenu = () => {
    if (!exportMenuOpen) setExportBidPct("0");
    setExportMenuOpen((value) => !value);
  };

  // Xuất KW đang chọn ra Excel (Keyword, Bid); bid theo quy tắc Bid giống lúc lên camp
  const handleExportKeywords = async () => {
    if (selectedRows.length === 0) return;
    setBusy("export");
    try {
      // Cùng 1 keyword ở nhiều SKU → gộp lại, CPC = tổng spend / tổng click
      const byTerm = new Map<string, LaunchItem>();
      for (const it of buildItems(selectedRows, selectedSku)) {
        const key = it.term.toLowerCase();
        const existing = byTerm.get(key);
        if (existing) {
          existing.clicks += it.clicks;
          existing.spend += it.spend;
        } else {
          byTerm.set(key, { ...it });
        }
      }
      const rows = Array.from(byTerm.values());
      for (const it of rows) it.cpc = it.clicks > 0 ? round2(it.spend / it.clicks) : 0;
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Keywords");
      sheet.columns = [
        { header: "Keyword", key: "term", width: 40 },
        { header: "Bid", key: "bid", width: 10, style: { numFmt: "0.00" } },
      ];
      sheet.getRow(1).font = { bold: true };
      const bidSettings: LaunchSettings = { ...DEFAULT_SETTINGS, bidRule: "cpc_pct", bidValue: parsePct(exportBidPct) };
      for (const it of rows) sheet.addRow({ term: it.term, bid: computeBid(it, bidSettings) });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Keywords_${storeName.replace(/[^A-Za-z0-9._-]+/g, "_")}_${formatYYYYMMDD()}_${rows.length}KW.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Đã xuất ${rows.length} keyword.`, "success");
      setExportMenuOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi xuất file.", "error");
    } finally {
      setBusy(null);
    }
  };

  const selectedRuns = LAUNCH_RUN_TYPES.filter((t) => settings.runTypes.includes(t.value));
  const runSetting = (v: LaunchRunType): RunSetting => settings.runSettings[v] ?? defaultRunSettings()[v];
  const anyKeyword = selectedRuns.some((t) => t.target === "keyword");
  const anySp = selectedRuns.some((t) => t.adProduct === "SP");
  const isSb = selectedRuns.some((t) => t.adProduct === "SB");
  const toggleRunType = (v: LaunchRunType) =>
    updateSettings({ runTypes: settings.runTypes.includes(v) ? settings.runTypes.filter((x) => x !== v) : [...settings.runTypes, v] });
  const updateRunSetting = (v: LaunchRunType, patch: Partial<RunSetting>) =>
    updateSettings({ runSettings: { ...settings.runSettings, [v]: { ...runSetting(v), ...patch } } });

  useEffect(() => {
    if (!open || (sbInfos?.type === settings.fulfillment && sbInfos.store === storeName)) return;
    const type = settings.fulfillment;
    const store = storeName;
    let cancelled = false;
    fetch(`/api/ppc/new-camp/skus?type=${type}&merge=1&store=${encodeURIComponent(store)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json.success) return;
        setSbInfos({
          type,
          store,
          map: new Map((json.data as NewCampSkuInfo[]).map((x) => [x.sku.toUpperCase(), x])),
          storeDefaults: (json.storeDefaults as StoreSbDefaults | null) ?? null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, settings.fulfillment, storeName, sbInfos?.type, sbInfos?.store]);

  const sbRuns = { sb01: settings.runTypes.includes("SB01"), sb05: settings.runTypes.includes("SB05") };
  // SKU không có trong BẢNG MÃ đang chọn vẫn dùng Entity / Logo / Brand Name của store (chung FBA và FBM)
  const sbRawInfoOf = (sku: string) => (isSb && sbInfos?.type === settings.fulfillment ? sbInfos.map.get(sku.toUpperCase()) : undefined);
  const sbInfoOf = (sku: string) => {
    if (!isSb || sbInfos?.type !== settings.fulfillment) return undefined;
    const raw = sbInfos.map.get(sku.toUpperCase());
    return sbInfos.storeDefaults ? withStoreSbDefaults(raw, sku, sbInfos.storeDefaults) : raw;
  };
  const sbReady = isSb && sbInfos?.type === settings.fulfillment;
  // Trường BẢNG MÃ còn trống (hiện ô nhập); còn thiếu = chưa điền bổ sung
  const sbBlankFields = (sku: string): SbField[] => (sbReady ? missingSbFields(sbInfoOf(sku), undefined, sbRuns) : []);
  const sbBlankOptional = (sku: string): SbField[] => (sbReady ? missingSbFields(sbInfoOf(sku), undefined, sbRuns, "optional") : []);
  const sbMissing = (sku: string): SbField[] => (sbReady ? missingSbFields(sbInfoOf(sku), sbOverrides[sku.toUpperCase()], sbRuns) : []);
  const setSbOverride = (sku: string, field: SbField, value: string) =>
    setSbOverrides((prev) => ({ ...prev, [sku.toUpperCase()]: { ...prev[sku.toUpperCase()], [field]: value } }));
  const launchRuns: LaunchRunConfig[] = selectedRuns.map((t) => ({
    runType: t.value,
    matchTypes: t.target === "keyword" ? LAUNCH_MATCH_TYPES.filter((m) => runSetting(t.value).matchTypes[m.key]).map((m) => m.key) : [],
    dailyBudget: runSetting(t.value).dailyBudget,
    bidPct: runSetting(t.value).bidPct,
  }));
  // Match type mặc định khi sửa riêng SKU: gộp các dạng keyword đang chọn
  const enabledMatchTypes = LAUNCH_MATCH_TYPES.filter((m) => launchRuns.some((r) => r.matchTypes.includes(m.key)));
  const usable = (it: LaunchItem) => selectedRuns.some((t) => isTermUsableForRunType(it.term, t.value));
  const usableItems = items.filter(usable);
  const missingSkuCount = usableItems.filter((it) => !it.sku.trim() || it.sku === UNKNOWN_SKU).length;

  const groups = useMemo(() => {
    const map = new Map<string, LaunchItem[]>();
    for (const it of items) {
      if (!map.has(it.sku)) map.set(it.sku, []);
      map.get(it.sku)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNKNOWN_SKU) return -1;
      if (b === UNKNOWN_SKU) return 1;
      return a.localeCompare(b);
    });
  }, [items]);

  const launchTerms = usableItems
    .filter((it) => it.sku.trim() && it.sku !== UNKNOWN_SKU)
    .map((it) => ({ term: it.term, sku: it.sku, bid: bidFor(it), clicks: it.clicks, spend: it.spend }));
  const launchOptions = {
    runs: launchRuns,
    biddingStrategy: settings.biddingStrategy,
    userName: userName.trim() || "Loan",
    dateStr,
    suffix: settings.suffix,
    fulfillment: settings.fulfillment,
    skuOverrides,
    commonBid: Number(commonBid) > 0 ? Number(commonBid) : undefined,
    kwPlus: anyKeyword && kwPlus,
    trangThai: settings.trangThai,
    nameEdits,
    skuNames: sbInfos?.type === settings.fulfillment
      ? Object.fromEntries(
        [...new Set(launchTerms.map((t) => t.sku.toUpperCase()))].map((sku) => {
          const info = sbInfos.map.get(sku);
          return [sku, { productType: info?.productType, niche: info?.niche, status: info?.status }];
        }),
      )
      : undefined,
  };
  const plan = buildMultiLaunchPlan(launchTerms, launchOptions, launchRuns);
  const campaignsBySku = new Map<string, LaunchCampaign[]>();
  for (const camp of plan.campaigns) {
    if (!campaignsBySku.has(camp.sku)) campaignsBySku.set(camp.sku, []);
    campaignsBySku.get(camp.sku)!.push(camp);
  }

  const sbMissingSkus = isSb ? [...campaignsBySku.keys()].filter((sku) => sbMissing(sku).length > 0) : [];
  const sbLoading = isSb && sbInfos?.type !== settings.fulfillment;

  const campNamesLower = plan.campaigns.map((c) => c.name.toLowerCase());
  const dupCampaign = plan.campaigns.find((c, i) => campNamesLower.indexOf(c.name.toLowerCase()) !== i);
  const setNameEdit = (camp: LaunchCampaign, value: string) => {
    const name = value.replace(/\s+/g, " ").trim();
    setNameEdits((prev) => {
      const next = { ...prev };
      if (!name || name === camp.defaultName) delete next[camp.key];
      else next[camp.key] = name;
      return next;
    });
  };

  const noMatchRun = launchRuns.find((r) => launchRunType(r.runType).target === "keyword" && r.matchTypes.length === 0);
  const blocker =
    selectedRuns.length === 0
      ? "Chọn ít nhất 1 dạng chạy."
      : usableItems.length === 0
      ? "Không có term nào phù hợp dạng chạy đã chọn."
      : noMatchRun
        ? `${launchRunType(noMatchRun.runType).label}: chọn ít nhất 1 match type.`
        : missingSkuCount > 0
          ? `Còn ${missingSkuCount} term chưa có SKU.`
          : sbLoading
            ? "Đang tải thông tin SB…"
            : dupCampaign
              ? `Tên camp bị trùng: ${dupCampaign.name}`
              : null;
  const uploadBlocker = sbMissingSkus.length > 0 ? `${sbMissingSkus.length} SKU thiếu thông tin SB: tải file được, chưa upload tự động được.` : null;

  const renameSku = (fromSku: string, toSku: string) => {
    const next = toSku.trim().toUpperCase();
    setItems((prev) => prev.map((it) => (it.sku === fromSku ? { ...it, sku: next } : it)));
    setSkuOverrides((prev) => {
      if (!prev[fromSku]) return prev;
      const { [fromSku]: moved, ...rest } = prev;
      return { ...rest, [next]: { ...rest[next], ...moved } };
    });
    setExpandedSkus((prev) => (prev.has(fromSku) ? new Set([...prev, next]) : prev));
  };

  const updateSkuOverride = (sku: string, patch: LaunchSkuOverride) => {
    setSkuOverrides((prev) => {
      const merged: LaunchSkuOverride = { ...prev[sku], ...patch };
      for (const key of Object.keys(merged) as (keyof LaunchSkuOverride)[]) {
        if (merged[key] === undefined) delete merged[key];
      }
      const next = { ...prev };
      if (Object.keys(merged).length > 0) next[sku] = merged;
      else delete next[sku];
      return next;
    });
  };

  // Bid chung riêng SKU: áp cho mọi term của SKU này; xóa trống thì quay về bid chung ở trên (hoặc theo CPC)
  const applySkuCommonBid = (sku: string, value: string) => {
    const num = Number(value);
    const bid = value === "" || !Number.isFinite(num) || num <= 0 ? null : num;
    updateSkuOverride(sku, { commonBid: bid ?? undefined });
    const fallback = Number(commonBid) > 0 ? Number(commonBid) : null;
    setItems((prev) => prev.map((it) => (it.sku === sku ? { ...it, bidOverride: bid ?? fallback } : it)));
  };

  const resetSkuOverride = (sku: string) => {
    if (skuOverrides[sku]?.commonBid) applySkuCommonBid(sku, "");
    setSkuOverrides((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });
  };

  const toggleSkuExpanded = (sku: string) => {
    setExpandedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const setItemSku = (id: string, sku: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, sku: sku.trim().toUpperCase() } : it)));
  };

  const setItemBid = (id: string, value: string) => {
    const num = Number(value);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, bidOverride: value === "" || !Number.isFinite(num) ? null : num } : it)));
  };

  const applyCommonBid = (value: string) => {
    setCommonBid(value);
    const num = Number(value);
    const bid = value === "" || !Number.isFinite(num) || num <= 0 ? null : num;
    setItems((prev) => prev.map((it) => (skuOverrides[it.sku]?.commonBid ? it : { ...it, bidOverride: bid })));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const requestBody = (mode: "export" | "upload") =>
    JSON.stringify({ mode, storeName, storeId, terms: launchTerms, options: launchOptions, sbOverrides: isSb ? sbOverrides : undefined });

  const finish = () => {
    setOpen(false);
    onLaunched();
  };

  const handleExport = async () => {
    if (blocker) return;
    setBusy("export");
    try {
      const res = await fetch("/api/ppc/campaign-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("export"),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Lỗi xuất file (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const match = (res.headers.get("Content-Disposition") || "").match(/filename="?([^";\n]+)"?/i);
      const filename = match?.[1] || "Launch_Campaigns.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Đã tải ${filename}`, "success");
      finish();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi xuất bulk file.", "error");
    } finally {
      setBusy(null);
    }
  };

  const pollUpload = (jobId: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const log = json.data?.log;
        if (res.ok && json.success && log) {
          const status = String(log.status || "");
          const error = log.errorMessage ?? log.error_message ?? log.resultSummary ?? log.result_summary;
          setUploadStatus({ jobId, status, progress: log.progressPct ?? log.progress_pct, error });
          if (status === "SUCCESS" || status === "PARTIAL_SUCCESS") {
            notify("Upload lên Amazon thành công.", "success");
            finish();
            return;
          }
          if (status === "FAILED" || status === "RESULT_TIMEOUT") {
            notify(`Upload thất bại: ${error || status}`, "error");
            return;
          }
        }
      } catch { }
      pollRef.current = setTimeout(tick, 3000);
    };
    void tick();
  };

  const handleUpload = async () => {
    if (blocker || uploadBlocker) return;
    if (!confirm(`Upload ${plan.campaigns.length} campaign lên Amazon store ${storeName}?`)) return;
    setBusy("upload");
    try {
      const res = await fetch("/api/ppc/campaign-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("upload"),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || json.message || `Lỗi upload (HTTP ${res.status})`);
      setUploadStatus({ jobId: json.jobId, status: "QUEUED" });
      pollUpload(json.jobId);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi upload.", "error");
    } finally {
      setBusy(null);
    }
  };

  const uploading = Boolean(uploadStatus && !["FAILED", "RESULT_TIMEOUT"].includes(uploadStatus.status));
  const uploadFailed = Boolean(uploadStatus && ["FAILED", "RESULT_TIMEOUT"].includes(uploadStatus.status));
  const inputCls = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
  const labelCls = "mb-1 block text-xs font-medium text-slate-500";
  const sectionTitleCls = "text-xs font-bold uppercase tracking-wide text-slate-400";
  const datalistId = "ppc-st-launch-skus";

  return (
    <>
      <div className="flex items-center gap-1.5">
        {selectedRows.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            Bỏ chọn
          </button>
        )}
        <button
          type="button"
          onClick={openPanel}
          disabled={selectedRows.length === 0}
          title={selectedRows.length === 0 ? "Tick chọn term / target để lên camp" : undefined}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          Lên camp{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
        </button>
        {selectedRows.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={openExportMenu}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download size={13} weight="bold" /> Export KW
            </button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1.5 w-60 space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-500">Bid = CPC + %</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExportBidPct((v) => formatPct(parsePct(v) - 5))}
                        className="h-8 w-8 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={exportBidPct}
                        onChange={(e) => setExportBidPct(e.target.value.replace(/[^0-9.+-]/g, ""))}
                        className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setExportBidPct((v) => formatPct(parsePct(v) + 5))}
                        className="h-8 w-8 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleExportKeywords()}
                    disabled={busy !== null}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy === "export" ? <CircleNotch size={13} className="animate-spin" /> : <Download size={13} weight="bold" />}
                    Xuất Excel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/25" onClick={() => !busy && !uploading && setOpen(false)}>
          <div
            className="flex h-full w-full max-w-[960px] flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-base font-bold text-slate-900">Lên camp</div>
                <div className="text-sm text-slate-500">{storeName}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={Boolean(busy) || uploading}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Dạng chạy: chọn nhiều, mỗi dạng 1 hàng cài đặt */}
              <section className="border-b border-slate-100 px-6 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {LAUNCH_RUN_TYPES.map((t) => {
                      const on = settings.runTypes.includes(t.value);
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => toggleRunType(t.value)}
                          title={t.label}
                          className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold cursor-pointer ${
                            on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                          }`}
                        >
                          {t.value}
                          <span className={`ml-1 text-xs font-medium ${on ? "text-indigo-100" : "text-slate-400"}`}>
                            {t.label.replace(/^\S+\s*/, "")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex rounded-lg border border-slate-200 p-0.5">
                    {(["FBA", "FBM"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => updateSettings({ fulfillment: f })}
                        className={`rounded-md px-3 py-1 text-sm font-semibold cursor-pointer ${
                          settings.fulfillment === f ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  {anyKeyword && (
                    <label
                      className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-slate-600"
                      title='Thêm keyword "a+b+c" cho mỗi keyword nhiều từ'
                    >
                      <input type="checkbox" checked={kwPlus} onChange={(e) => setKwPlus(e.target.checked)} className="h-4 w-4 cursor-pointer accent-indigo-600" />
                      KW plus
                    </label>
                  )}
                </div>

                {selectedRuns.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-medium">Dạng chạy</th>
                          <th className="px-2 py-1.5 text-left font-medium">Match type</th>
                          <th className="px-2 py-1.5 text-left font-medium">Budget ($)</th>
                          <th className="px-2 py-1.5 text-left font-medium" title="% so với bid ở cột Bid bên dưới (CPC hoặc bid đã nhập)">Bid (% bid gốc)</th>
                          <th className="px-2 py-1.5 text-right font-medium">Camp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedRuns.map((t) => {
                          const rs = runSetting(t.value);
                          const campCount = plan.campaigns.filter((c) => c.runType === t.value).length;
                          return (
                            <tr key={t.value}>
                              <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-800">{t.label}</td>
                              <td className="px-2 py-1.5">
                                {t.target === "keyword" ? (
                                  <div className="flex gap-1">
                                    {LAUNCH_MATCH_TYPES.map((m) => (
                                      <button
                                        key={m.key}
                                        type="button"
                                        onClick={() => updateRunSetting(t.value, { matchTypes: { ...rs.matchTypes, [m.key]: !rs.matchTypes[m.key] } })}
                                        className={`rounded-md border px-2 py-0.5 text-xs font-semibold cursor-pointer ${
                                          rs.matchTypes[m.key] ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-400 hover:text-slate-600"
                                        }`}
                                      >
                                        {m.label}
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">{t.target === "asin" ? "Target ASIN" : "Auto"}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={rs.dailyBudget}
                                  onChange={(e) => updateRunSetting(t.value, { dailyBudget: Number(e.target.value) })}
                                  className={`${inputCls} w-16 py-1`}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="10"
                                    max="500"
                                    step="5"
                                    value={rs.bidPct}
                                    onChange={(e) => updateRunSetting(t.value, { bidPct: Number(e.target.value) })}
                                    className={`${inputCls} w-16 py-1 text-right`}
                                  />
                                  <span className="text-xs text-slate-400">%</span>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs text-slate-500">{campCount}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Ngân sách, bid, tên campaign */}
              <section className="border-b border-slate-100 px-6 py-4">
                <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
                  {anySp && (
                    <label>
                      <span className={labelCls}>Bidding strategy (SP)</span>
                      <select
                        value={settings.biddingStrategy}
                        onChange={(e) => updateSettings({ biddingStrategy: e.target.value as LaunchBiddingStrategy })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        {LAUNCH_BIDDING_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                  )}
                  <div>
                    <span className={labelCls}>Bid</span>
                    <div className="flex gap-1.5">
                      <select
                        value={settings.bidRule}
                        onChange={(e) => updateSettings({ bidRule: e.target.value as BidRule })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        <option value="cpc">Bằng CPC</option>
                        <option value="cpc_pct">CPC ± %</option>
                      </select>
                      {settings.bidRule === "cpc_pct" && (
                        <input
                          type="number"
                          step="5"
                          value={settings.bidValue}
                          onChange={(e) => updateSettings({ bidValue: Number(e.target.value) })}
                          className={`${inputCls} w-16`}
                        />
                      )}
                    </div>
                  </div>
                  {/* Bid chung: điền là áp cho mọi term, xóa trống thì quay về bid theo CPC */}
                  <label>
                    <span className={labelCls}>Bid chung ($)</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      value={commonBid}
                      placeholder="Để trống"
                      onChange={(e) => applyCommonBid(e.target.value)}
                      className={`${inputCls} w-24`}
                    />
                  </label>
                  <label>
                    <span className={labelCls}>Người làm</span>
                    <input value={userName} onChange={(e) => updateUserName(e.target.value)} className={`${inputCls} w-20`} />
                  </label>
                  <label>
                    <span className={labelCls}>Test / Win</span>
                    <select
                      value={settings.trangThai}
                      onChange={(e) => updateSettings({ trangThai: e.target.value as LaunchTrangThai })}
                      title="Auto: SKU FBA trạng thái Phát triển = Win, còn lại Test (FBM luôn Test)"
                      className={`${inputCls} cursor-pointer`}
                    >
                      {TRANG_THAI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className={labelCls}>Ngày</span>
                    <input
                      value={dateStr}
                      onChange={(e) => setDateStr(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      inputMode="numeric"
                      placeholder="YYYYMMDD"
                      title="Ngày trong tên campaign (YYYYMMDD), mặc định hôm nay"
                      className={`${inputCls} w-[104px] font-mono ${/^\d{8}$/.test(dateStr) ? "" : "border-rose-400"}`}
                    />
                  </label>
                  <label className="min-w-[110px] flex-1">
                    <span className={labelCls}>Đuôi tên</span>
                    <input
                      value={settings.suffix}
                      onChange={(e) => updateSettings({ suffix: e.target.value })}
                      placeholder="Không bắt buộc"
                      className={`${inputCls} w-full`}
                    />
                  </label>
                </div>
              </section>

              {/* 4. Search term theo SKU */}
              <section className="px-6 py-4">
                <div className={`${sectionTitleCls} mb-2.5`}>Search term · {usableItems.length}</div>

                <datalist id={datalistId}>
                  {knownSkus.map((sku) => <option key={sku} value={sku} />)}
                </datalist>

                <div className="space-y-3">
                  {groups.map(([sku, skuItems]) => {
                    const unknown = sku === UNKNOWN_SKU || !sku.trim();
                    const campNames = campaignsBySku.get(sku) || [];
                    const override = skuOverrides[sku];
                    const expanded = expandedSkus.has(sku);
                    const skuMatchTypes = override?.matchTypes ?? enabledMatchTypes.map((m) => m.key);
                    return (
                      <div key={sku || "empty"} className={`overflow-hidden rounded-xl border ${unknown ? "border-amber-300" : "border-slate-200"}`}>
                        <div className={`border-b px-3.5 py-2 ${unknown ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                          <div className="flex items-center gap-2">
                            {unknown ? (
                              <span className="text-sm font-semibold text-amber-800">Chưa có SKU, nhập cho từng term</span>
                            ) : (
                              <input
                                key={sku}
                                defaultValue={sku}
                                list={datalistId}
                                onBlur={(e) => e.target.value.trim() && e.target.value.trim().toUpperCase() !== sku && renameSku(sku, e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                className="-mx-1 min-w-0 flex-1 rounded px-1 py-0.5 bg-transparent font-mono text-sm font-bold text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-200"
                              />
                            )}
                            {campNames.length > 0 ? (
                              <span className="ml-auto shrink-0 text-xs text-slate-400">{skuItems.length} term · {campNames.length} camp</span>
                            ) : (
                              <span className="ml-auto shrink-0 text-xs font-medium text-amber-700">Không có camp nào</span>
                            )}
                            {!unknown && (
                              <button
                                type="button"
                                onClick={() => toggleSkuExpanded(sku)}
                                className={`shrink-0 rounded-md p-1 cursor-pointer hover:bg-slate-200 ${
                                  override ? "text-indigo-600" : "text-slate-400 hover:text-slate-700"
                                }`}
                              >
                                <CaretDown size={14} weight="bold" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                              </button>
                            )}
                          </div>
                          {!unknown && sbBlankFields(sku).length + sbBlankOptional(sku).length > 0 && (
                            <div className="mt-2 rounded-lg border border-rose-200 bg-white p-2.5">
                              <div className={`mb-1.5 text-xs font-semibold ${sbBlankFields(sku).length ? "text-rose-600" : "text-slate-500"}`}>
                                {sbRawInfoOf(sku) ? "BẢNG MÃ thiếu thông tin SB" : "SKU không có trong BẢNG MÃ FBA / FBM"} · chỉ dùng cho lần này
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {[...sbBlankFields(sku), ...sbBlankOptional(sku)].map((f) => {
                                  const value = sbOverrides[sku.toUpperCase()]?.[f] ?? "";
                                  const optional = !sbBlankFields(sku).includes(f);
                                  return (
                                    <label key={f} className="min-w-0">
                                      <span className={labelCls}>{SB_FIELD_LABELS[f]}{optional ? " (không bắt buộc)" : ""}</span>
                                      <input
                                        value={value}
                                        placeholder={SB_FIELD_PLACEHOLDERS[f]}
                                        onChange={(e) => setSbOverride(sku, f, e.target.value)}
                                        className={`${inputCls} w-full font-mono text-xs ${value.trim() || optional ? "" : "border-rose-300"}`}
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {expanded && !unknown && (
                            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
                              {anyKeyword && (
                                <div className="flex gap-1">
                                  {LAUNCH_MATCH_TYPES.map((m) => {
                                    const on = skuMatchTypes.includes(m.key);
                                    return (
                                      <button
                                        key={m.key}
                                        type="button"
                                        onClick={() =>
                                          updateSkuOverride(sku, {
                                            matchTypes: on ? skuMatchTypes.filter((k) => k !== m.key) : [...skuMatchTypes, m.key],
                                          })
                                        }
                                        className={`rounded-md border px-2 py-1 text-xs font-semibold cursor-pointer ${
                                          on ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-400 hover:text-slate-600"
                                        }`}
                                      >
                                        {m.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              <label>
                                <span className="mb-0.5 block text-[11px] text-slate-500">Budget ($)</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={override?.dailyBudget ?? ""}
                                  placeholder="Theo dạng"
                                  title="Để trống: dùng Budget của từng dạng chạy ở trên"
                                  onChange={(e) => updateSkuOverride(sku, { dailyBudget: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
                                  className={`${inputCls} w-16 py-1 text-xs`}
                                />
                              </label>
                              {anySp && (
                                <label>
                                  <span className="mb-0.5 block text-[11px] text-slate-500">Bidding strategy</span>
                                  <select
                                    value={override?.biddingStrategy ?? settings.biddingStrategy}
                                    onChange={(e) => updateSkuOverride(sku, { biddingStrategy: e.target.value as LaunchBiddingStrategy })}
                                    className={`${inputCls} py-1 text-xs cursor-pointer`}
                                  >
                                    {LAUNCH_BIDDING_STRATEGIES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
                                  </select>
                                </label>
                              )}
                              <label>
                                <span className="mb-0.5 block text-[11px] text-slate-500">Test / Win</span>
                                <select
                                  value={override?.trangThai ?? settings.trangThai}
                                  onChange={(e) => updateSkuOverride(sku, { trangThai: e.target.value as LaunchTrangThai })}
                                  className={`${inputCls} py-1 text-xs cursor-pointer`}
                                >
                                  {TRANG_THAI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </label>
                              <label>
                                <span className="mb-0.5 block text-[11px] text-slate-500">Bid chung ($)</span>
                                <input
                                  type="number"
                                  step="0.05"
                                  min="0.1"
                                  value={override?.commonBid ?? ""}
                                  placeholder={commonBid || "Để trống"}
                                  onChange={(e) => applySkuCommonBid(sku, e.target.value)}
                                  className={`${inputCls} w-20 py-1 text-xs`}
                                />
                              </label>
                              <label className="min-w-[100px] flex-1">
                                <span className="mb-0.5 block text-[11px] text-slate-500">Đuôi tên</span>
                                <input
                                  value={override?.suffix ?? settings.suffix}
                                  onChange={(e) => updateSkuOverride(sku, { suffix: e.target.value })}
                                  className={`${inputCls} w-full py-1 text-xs`}
                                />
                              </label>
                              {override && (
                                <button
                                  type="button"
                                  onClick={() => resetSkuOverride(sku)}
                                  className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
                                >
                                  Đặt lại
                                </button>
                              )}
                            </div>
                          )}
                          {campNames.length > 0 && (
                            <div className="mt-1 space-y-0.5 font-mono text-[11px] leading-snug text-slate-500">
                              {campNames.map((camp) => {
                                const edited = nameEdits[camp.key] !== undefined;
                                const dup = dupCampaign && camp.name.toLowerCase() === dupCampaign.name.toLowerCase();
                                return editingName === camp.key ? (
                                  <input
                                    key={camp.key}
                                    autoFocus
                                    defaultValue={camp.name}
                                    onBlur={(e) => {
                                      setNameEdit(camp, e.target.value);
                                      setEditingName(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                      if (e.key === "Escape") setEditingName(null);
                                    }}
                                    className="w-full rounded border border-indigo-400 bg-white px-1 py-0.5 font-mono text-[11px] text-slate-800 outline-none ring-2 ring-indigo-100"
                                  />
                                ) : (
                                  <div key={camp.key} className="group flex items-start gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditingName(camp.key)}
                                      title="Bấm để sửa tên camp"
                                      className={`min-w-0 cursor-text break-all rounded px-0.5 text-left hover:bg-white hover:ring-1 hover:ring-slate-200 ${
                                        dup ? "text-rose-600" : edited ? "text-indigo-700" : ""
                                      }`}
                                    >
                                      {camp.name}
                                    </button>
                                    {edited && (
                                      <button
                                        type="button"
                                        onClick={() => setNameEdit(camp, "")}
                                        title={`Về tên tự đặt: ${camp.defaultName}`}
                                        className="shrink-0 cursor-pointer rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                      >
                                        ↺
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <table className="w-full table-fixed text-sm">
                          <colgroup>
                            <col />
                            <col className="w-14" />
                            <col className="w-20" />
                            <col className="w-24" />
                            <col className="w-9" />
                          </colgroup>
                          <thead>
                            <tr>
                              <td className="py-1.5 pl-3.5 pr-2 text-left text-xs text-slate-400">Search term</td>
                              <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-600">Đơn</td>
                              <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-600">CPC</td>
                              <td className="px-1 py-1.5 text-right text-xs font-semibold text-slate-600">Bid</td>
                              <td />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {skuItems.map((it) => (
                              <Fragment key={it.id}>
                              <tr className={usable(it) ? "" : "opacity-40"}>
                                <td className="py-2 pl-3.5 pr-2 text-slate-800">
                                  <div className="break-words">
                                    {it.term}
                                    {it.isAsin && (
                                      <span className="ml-2 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">ASIN</span>
                                    )}
                                    {!usable(it) && (
                                      <span className="ml-2 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">bỏ qua</span>
                                    )}
                                  </div>
                                  {unknown && usable(it) && (
                                    <input
                                      placeholder="Nhập SKU"
                                      list={datalistId}
                                      onBlur={(e) => e.target.value.trim() && setItemSku(it.id, e.target.value)}
                                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                      className={`${inputCls} mt-1.5 w-48 font-mono`}
                                    />
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-right text-slate-500">{it.orders}</td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-slate-500">
                                  {it.cpc > 0 ? `$${it.cpc.toFixed(2)}` : "—"}
                                </td>
                                <td className="px-1 py-2">
                                  <input
                                    type="number"
                                    step="0.05"
                                    min="0.1"
                                    value={it.bidOverride ?? ""}
                                    placeholder={bidFor(it).toFixed(2)}
                                    onChange={(e) => setItemBid(it.id, e.target.value)}
                                    className={`${inputCls} w-full py-1 text-right font-mono placeholder:text-slate-700`}
                                  />
                                </td>
                                <td className="py-2 pr-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(it.id)}
                                    className="rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                                  >
                                    <X size={14} />
                                  </button>
                                </td>
                              </tr>
                              {launchOptions.kwPlus && usable(it) && kwPlusVariant(it.term) && (
                                <tr className="bg-indigo-50/40">
                                  <td className="py-2 pl-3.5 pr-2 text-slate-800">
                                    <div className="break-words">
                                      {kwPlusVariant(it.term)}
                                      <span className="ml-2 whitespace-nowrap rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">KW plus</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-right text-slate-300">—</td>
                                  <td className="px-2 py-2 text-right text-slate-300">—</td>
                                  <td className="px-2 py-2 text-right font-mono text-slate-500" title="Cùng bid với keyword gốc">{bidFor(it).toFixed(2)}</td>
                                  <td />
                                </tr>
                              )}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-3 border-t border-slate-200 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-bold text-slate-900">{usableItems.length}</span> term ·{" "}
                  {launchOptions.kwPlus && (
                    <>
                      <span className="font-bold text-slate-900">{countLaunchTargets(plan)}</span> keyword ·{" "}
                    </>
                  )}
                  <span className="font-bold text-slate-900">{campaignsBySku.size}</span> SKU ·{" "}
                  <span className="font-bold text-slate-900">{plan.campaigns.length}</span> campaign
                </span>
                {(blocker || uploadBlocker) && <span className="font-semibold text-amber-700">{blocker || uploadBlocker}</span>}
              </div>
              {uploadStatus && (
                <div className={`text-sm ${uploadFailed ? "text-rose-600" : "text-slate-600"}`}>
                  {uploadFailed
                    ? `Upload thất bại: ${uploadStatus.error || uploadStatus.status}`
                    : `Đang upload lên Amazon… ${uploadStatus.progress != null ? `${uploadStatus.progress}%` : uploadStatus.status}`}
                </div>
              )}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={Boolean(blocker) || Boolean(busy) || uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "export" && <CircleNotch size={15} className="animate-spin" />}
                  Tải bulk file
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={Boolean(blocker) || Boolean(uploadBlocker) || Boolean(busy) || uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {(busy === "upload" || uploading) && <CircleNotch size={15} className="animate-spin" />}
                  Upload lên Amazon
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
