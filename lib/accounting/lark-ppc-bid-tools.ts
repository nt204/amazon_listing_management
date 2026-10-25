import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { getCachedOrFetch, getRedisClient } from "@/lib/redis";
import { listTargetRowsForRecommendations } from "@/lib/ppc/repository";
import {
  approveRecommendationsToActionQueue,
  executeAutoUploadZeroSpendActions,
  getAccountingStoreForPpcStore,
  getAutoUploadLogs,
  getGroupedRecommendations,
  getSkuEconomicsList,
} from "@/lib/ppc/sku-architecture-service";
import { groupedRecommendationsRedisKey } from "@/lib/ppc/recommendation-cache";
import { reviewPpcRecommendationWithAi } from "@/lib/ppc/ai-review-service";
import type { PpcRecommendation } from "@/lib/ppc/types";
import { resolvePpcStore } from "./lark-agent-tools";
import { listSkuWin } from "./sku-win-db";
import {
  clearPendingAction,
  getLastBidRecommendations,
  getPendingAction,
  setLastBidRecommendations,
  setPendingAction,
  type PendingBidItem,
  type PendingPpcAction,
} from "./lark-conversation-memory";

const LARK_APPROVER = "Lark Bot AI";
const RECOMMENDATION_CACHE_TTL_SECONDS = 10 * 60;
const MAX_ITEMS_PER_CONFIRM = 50;
const MIN_BID = 0.02;
const MAX_BID = 20;

type BidType = "ALL" | "INCREASE" | "DECREASE" | "PAUSE";

const REC_TYPE_BY_FILTER: Record<Exclude<BidType, "ALL">, PpcRecommendation["recType"]> = {
  INCREASE: "BID_INCREASE",
  DECREASE: "BID_DECREASE",
  PAUSE: "PAUSE_TARGET",
};

function actionLabel(rec: PpcRecommendation): string {
  if (rec.recType === "PAUSE_TARGET") return "⏸️ Tạm dừng";
  if (rec.recType === "BID_INCREASE") return "🔺 Tăng bid";
  return "🔻 Giảm bid";
}

function money(value: number | null | undefined): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  const a = Number(from || 0);
  const b = Number(to || 0);
  if (a <= 0 || b <= 0) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

function campaignFamily(rec: PpcRecommendation): string {
  const text = `${rec.ruleProfile || ""} ${rec.campaignName || ""}`.toUpperCase();
  if (/SB05|\bVIDEO\b/.test(text)) return "SB05";
  if (/SB01/.test(text)) return "SB01";
  return "SP03";
}

async function storeClarification() {
  const sql = await getDatabaseClient();
  const stores = await sql<Array<{ name: string }>>`SELECT name FROM ppc_stores ORDER BY name ASC`;
  return `Vui lòng cho biết store cần xem Auto Bid. Hệ thống hiện có: ${stores.map((s) => s.name).join(", ")}.`;
}

/** Kết quả AI Review gần nhất theo recommendation id, để "dùng bid AI cho số 3". */
const inMemoryAiBids = new Map<string, { bids: Record<string, number>; expiresAt: number }>();
const AI_BID_TTL_SECONDS = 900;

async function saveAiBid(sessionId: string, recommendationId: string, bid: number) {
  const bids = { ...(await loadAiBids(sessionId)), [recommendationId]: bid };
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(`lark:ai_bids:${sessionId}`, AI_BID_TTL_SECONDS, JSON.stringify(bids));
      return;
    } catch {
      // dùng bộ nhớ trong process
    }
  }
  inMemoryAiBids.set(sessionId, { bids, expiresAt: Date.now() + AI_BID_TTL_SECONDS * 1000 });
}

async function loadAiBids(sessionId: string): Promise<Record<string, number>> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const data = await redis.get(`lark:ai_bids:${sessionId}`);
      if (data) return JSON.parse(data) as Record<string, number>;
    } catch {
      // dùng bộ nhớ trong process
    }
  }
  const cached = inMemoryAiBids.get(sessionId);
  return cached && cached.expiresAt > Date.now() ? cached.bids : {};
}

const RECOMMENDATION_WINDOW_DAYS = 30;

/** Đề xuất Auto Bid 30 ngày, dùng chung cache Redis với tab Auto Bid trên web. */
async function loadGroupedRecommendations(store: { id: string; name: string; team_id?: string }) {
  const teamId = store.team_id || "default";
  const days = RECOMMENDATION_WINDOW_DAYS;
  return getCachedOrFetch(
    groupedRecommendationsRedisKey(teamId, store.name, days, false),
    RECOMMENDATION_CACHE_TTL_SECONDS,
    async () => {
      const targetRows = await listTargetRowsForRecommendations(
        { teamId, actorId: "lark-agent" },
        { storeName: store.name, days },
        { unbounded: true },
      );
      return getGroupedRecommendations(store.id, targetRows, days);
    },
  );
}

/**
 * 10. Danh sách đề xuất Auto Bid (tăng / giảm bid, tạm dừng target) của một store.
 * Dùng chung cache Redis với tab Auto Bid trên web nên số liệu trùng khớp.
 */
export async function listBidRecommendations(
  params: {
    storeQuery?: string;
    type?: BidType;
    sku?: string;
    campaignType?: "SP03" | "SB01" | "SB05";
    limit?: number;
  },
  sessionId?: string,
) {
  if (!params.storeQuery?.trim()) {
    return { hasData: false, needsStoreClarification: true, message: await storeClarification() };
  }
  const store = await resolvePpcStore(params.storeQuery);
  if (!store) {
    return { hasData: false, message: `Không tìm thấy store "${params.storeQuery}". ${await storeClarification()}` };
  }

  const days = RECOMMENDATION_WINDOW_DAYS;
  const grouped = await loadGroupedRecommendations(store);

  const all = grouped.allRecommendations;
  const summary = {
    total: all.length,
    increase: all.filter((r) => r.recType === "BID_INCREASE").length,
    decrease: all.filter((r) => r.recType === "BID_DECREASE").length,
    pause: all.filter((r) => r.recType === "PAUSE_TARGET").length,
  };

  const type = params.type && params.type !== "ALL" ? params.type : null;
  const sku = params.sku?.trim().toUpperCase();
  const filtered = all
    .filter((r) => !type || r.recType === REC_TYPE_BY_FILTER[type])
    .filter((r) => !sku || (r.sku || "").toUpperCase().includes(sku))
    .filter((r) => !params.campaignType || campaignFamily(r) === params.campaignType)
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));

  const limit = Math.min(30, Math.max(1, params.limit || 10));
  const shown = filtered.slice(0, limit);
  if (sessionId) await setLastBidRecommendations(sessionId, shown);

  if (shown.length === 0) {
    return {
      hasData: false,
      storeName: store.name,
      windowDays: days,
      summary,
      message: `Không có đề xuất Auto Bid phù hợp bộ lọc cho store ${store.name} (cửa sổ ${days} ngày).`,
    };
  }

  return {
    hasData: true,
    storeName: store.name,
    windowDays: days,
    summary,
    totalMatched: filtered.length,
    shownCount: shown.length,
    instructions:
      "Trình bày dạng danh sách đánh số gọn (KHÔNG dùng bảng ngang): '[STT]. [action] **[keyword]** (SKU: [sku], [campaignType])' rồi dòng '• Bid: $[currentBid] → $[newBid] ([changePct]%) | Clicks: N | Orders: N | Spend: $X | ACOS: Y%' và dòng '• Lý do: ...'. Đầu danh sách ghi tổng: X tăng, Y giảm, Z tạm dừng. Cuối danh sách nhắc: nhắn 'Duyệt số 1, 2' / 'Duyệt tất cả' / 'Số 3 đặt bid 0.65' / 'AI review số 2'.",
    items: shown.map((r, idx) => ({
      stt: idx + 1,
      action: actionLabel(r),
      sku: r.sku || "N/A",
      keyword: r.keyword,
      matchType: r.matchType || "Exact",
      campaignType: campaignFamily(r),
      campaign: r.campaignName || "",
      currentBid: money(r.currentBid),
      newBid: r.recType === "PAUSE_TARGET" ? null : money(r.recommendedBid),
      changePct: r.recType === "PAUSE_TARGET" ? null : pctChange(r.currentBid, r.recommendedBid),
      clicks: Number(r.clicks || 0),
      orders: Number(r.orders || 0),
      spend: money(r.spend),
      acos: r.sales && Number(r.sales) > 0 ? Math.round((Number(r.spend || 0) / Number(r.sales)) * 1000) / 10 : null,
      reason: r.reason,
    })),
  };
}

/**
 * 11. Tạo yêu cầu duyệt + Auto Upload các đề xuất bid. KHÔNG thực thi ngay:
 * lưu trạng thái chờ, người dùng phải bấm "Xác nhận" trên thẻ Lark.
 */
export async function requestBidAction(
  params: {
    itemIndices?: number[];
    all?: boolean;
    bidOverrides?: Array<{ stt: number; bid: number }>;
    useAiBidFor?: number[];
  },
  sessionId?: string,
) {
  if (!sessionId) {
    return { status: "ERROR", message: "Thao tác Auto Bid cần phiên hội thoại Lark để xác nhận." };
  }
  // Yêu cầu mới thay yêu cầu cũ: kể cả khi lần chọn mới lỗi, thẻ xác nhận cũ không còn hiệu lực.
  if ((await getPendingAction(sessionId))?.action === "AUTO_BID") await clearPendingAction(sessionId);
  const listed = await getLastBidRecommendations(sessionId);
  if (listed.length === 0) {
    return {
      status: "ERROR",
      message: "Chưa có danh sách đề xuất bid nào gần đây (hoặc đã hết hạn 15 phút). Hãy xem lại danh sách đề xuất Auto Bid trước.",
    };
  }

  const indices = params.all
    ? listed.map((_, idx) => idx + 1)
    : Array.from(new Set([
      ...(params.itemIndices || []),
      ...(params.bidOverrides || []).map((o) => o.stt),
      ...(params.useAiBidFor || []),
    ]));
  const invalid = indices.filter((stt) => !listed[stt - 1]);
  if (indices.length === 0 || invalid.length === indices.length) {
    return { status: "ERROR", message: `Số thứ tự không hợp lệ. Danh sách hiện có từ 1 đến ${listed.length}.` };
  }
  if (indices.length > MAX_ITEMS_PER_CONFIRM) {
    return { status: "ERROR", message: `Mỗi lần chỉ duyệt tối đa ${MAX_ITEMS_PER_CONFIRM} đề xuất.` };
  }

  const overrides = new Map((params.bidOverrides || []).map((o) => [o.stt, Number(o.bid)]));
  const aiBids = params.useAiBidFor?.length ? await loadAiBids(sessionId) : {};
  const useAi = new Set(params.useAiBidFor || []);
  const problems: string[] = invalid.length
    ? [`Bỏ qua số ${invalid.join(", ")} (danh sách chỉ có từ 1 đến ${listed.length}).`]
    : [];
  const bidItems: Array<PendingBidItem & { stt: number }> = [];

  for (const stt of indices) {
    const rec = listed[stt - 1];
    if (!rec) continue;
    if (rec.recType === "PAUSE_TARGET") {
      bidItems.push({ stt, recommendation: rec, finalBid: null, bidSource: "RULE_ENGINE" });
      continue;
    }
    let finalBid = money(rec.recommendedBid);
    let bidSource: PendingBidItem["bidSource"] = "RULE_ENGINE";
    if (overrides.has(stt)) {
      finalBid = money(overrides.get(stt));
      bidSource = "USER_EDIT";
    } else if (useAi.has(stt)) {
      const aiBid = aiBids[rec.id];
      if (aiBid == null) {
        problems.push(`Số ${stt} chưa có kết quả AI review (hãy chạy AI review số ${stt} trước).`);
        continue;
      }
      finalBid = money(aiBid);
      bidSource = "AI_AGENT";
    }
    if (!(finalBid >= MIN_BID && finalBid <= MAX_BID)) {
      problems.push(`Số ${stt}: bid $${finalBid} ngoài khoảng cho phép ($${MIN_BID} - $${MAX_BID}).`);
      continue;
    }
    bidItems.push({ stt, recommendation: rec, finalBid, bidSource });
  }

  if (bidItems.length === 0) {
    return { status: "ERROR", message: problems.join(" ") || "Không có đề xuất hợp lệ để duyệt." };
  }

  const first = bidItems[0].recommendation;
  const pending: PendingPpcAction = {
    action: "AUTO_BID",
    storeId: first.storeId,
    storeName: first.storeName,
    bidItems: bidItems.map(({ stt: _stt, ...item }) => item),
    createdAt: Date.now(),
  };
  await setPendingAction(sessionId, pending);

  const counts = {
    increase: bidItems.filter((it) => it.recommendation.recType === "BID_INCREASE").length,
    decrease: bidItems.filter((it) => it.recommendation.recType === "BID_DECREASE").length,
    pause: bidItems.filter((it) => it.finalBid === null).length,
  };

  return {
    status: "AWAITING_CONFIRMATION",
    requiresConfirmation: true,
    storeName: first.storeName,
    totalCount: bidItems.length,
    counts,
    skipped: problems,
    items: bidItems.map((it) => ({
      stt: it.stt,
      action: actionLabel(it.recommendation),
      sku: it.recommendation.sku || "N/A",
      keyword: it.recommendation.keyword,
      currentBid: money(it.recommendation.currentBid),
      newBid: it.finalBid,
      changePct: it.finalBid === null ? null : pctChange(it.recommendation.currentBid, it.finalBid),
      bidSource: it.bidSource === "USER_EDIT" ? "Bid tự nhập" : it.bidSource === "AI_AGENT" ? "Bid AI" : "Bid theo rule",
    })),
    instructionForAgent: `BẮT BUỘC: Thao tác CHƯA được thực thi. Hiển thị Thẻ Xác Nhận ĐƠN GIẢN, DỄ NHÌN:
- Store: ${first.storeName}
- Tổng: ${bidItems.length} thay đổi (${counts.increase} tăng, ${counts.decrease} giảm, ${counts.pause} tạm dừng)
- Liệt kê từng dòng: [STT]. [action] **[keyword]** (SKU) • $[currentBid] → $[newBid] ([changePct]%) • [bidSource]
${problems.length ? `- Ghi chú các dòng bị bỏ qua: ${problems.join(" ")}\n` : ""}- Nhắc: bấm [✅ Xác nhận Auto Upload] hoặc nhắn "Xác nhận" để duyệt và đẩy file lên Amazon Ads; nhắn "Hủy" để bỏ qua.
TUYỆT ĐỐI KHÔNG báo "đã cập nhật bid" ở bước này.`,
  };
}

/**
 * Thực thi sau khi người dùng xác nhận: duyệt vào hàng đợi rồi tạo file Bulk + xếp hàng Auto Upload.
 */
export async function executeConfirmBidAction(action: PendingPpcAction) {
  const items = action.bidItems || [];
  if (items.length === 0) throw new Error("Không có đề xuất bid nào để thực thi.");

  const sql = await getDatabaseClient();
  const storeRows = await sql<Array<{ team_id: string }>>`
    SELECT team_id FROM ppc_stores WHERE id = ${action.storeId} LIMIT 1
  `;
  const teamId = storeRows[0]?.team_id || "default";
  const startedAt = new Date();

  const approval = await approveRecommendationsToActionQueue(
    action.storeId,
    items.map((item) => ({
      recommendation: item.recommendation,
      userFinalBid: item.finalBid ?? undefined,
      approvedBy: LARK_APPROVER,
      decisionSource: item.bidSource,
    })),
    LARK_APPROVER,
  );

  const recommendationIds = items.map((item) => item.recommendation.id);
  const actionRows = await sql<Array<{ id: string }>>`
    SELECT id FROM ppc_actions
    WHERE store_id = ${action.storeId}
      AND recommendation_id = ANY(${recommendationIds})
      AND status = 'APPROVED'
      AND approved_by = ${LARK_APPROVER}
      AND approved_at >= ${startedAt}
  `;
  const actionIds = actionRows.map((row) => row.id);
  // Danh sách id rỗng sẽ khiến Auto Upload lấy CẢ hàng đợi của store, nên dừng tại đây.
  if (actionIds.length === 0) {
    return {
      uploaded: false,
      approvedCount: approval.addedCount,
      supersededCount: approval.supersededCount,
      actionCount: 0,
      jobId: null,
      fileName: "",
      error: "Không tìm thấy thay đổi vừa duyệt trong hàng đợi nên chưa upload.",
    };
  }

  try {
    const upload = await executeAutoUploadZeroSpendActions(action.storeId, actionIds, teamId, {
      allowAllSkus: true,
      createdBy: LARK_APPROVER,
    });
    return {
      uploaded: true,
      approvedCount: approval.addedCount,
      supersededCount: approval.supersededCount,
      actionCount: upload.log.actionCount,
      jobId: upload.log.id,
      fileName: upload.fileName || "",
      error: null as string | null,
    };
  } catch (error) {
    // Đã duyệt vào hàng đợi; chỉ bước tạo file / xếp hàng upload lỗi.
    return {
      uploaded: false,
      approvedCount: approval.addedCount,
      supersededCount: approval.supersededCount,
      actionCount: actionIds.length,
      jobId: null,
      fileName: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 12. Trạng thái hàng đợi Auto Bid và các job Auto Upload gần nhất.
 */
export async function getBidQueueStatus(params: { storeQuery?: string }) {
  const sql = await getDatabaseClient();
  const store = params.storeQuery ? await resolvePpcStore(params.storeQuery) : null;
  if (params.storeQuery && !store) {
    return { hasData: false, message: `Không tìm thấy store "${params.storeQuery}". ${await storeClarification()}` };
  }

  const queueRows = await sql<Array<{ store_name: string; status: string; action_type: string; count: number }>>`
    SELECT s.name AS store_name, a.status, a.action_type, COUNT(*)::int AS count
    FROM ppc_actions a
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE a.action_type IN ('UPDATE_BID', 'PAUSE_TARGET')
      AND (
        a.status IN ('APPROVED', 'QUEUED')
        OR (a.status = 'APPLIED' AND a.updated_at >= NOW() - INTERVAL '7 days')
      )
      ${store ? sql`AND a.store_id = ${store.id}` : sql``}
    GROUP BY s.name, a.status, a.action_type
    ORDER BY s.name
  `;

  const byStore = new Map<string, { store: string; waitingInQueue: number; appliedLast7Days: number }>();
  for (const row of queueRows) {
    const entry = byStore.get(row.store_name) || { store: row.store_name, waitingInQueue: 0, appliedLast7Days: 0 };
    if (row.status === "APPLIED") entry.appliedLast7Days += Number(row.count);
    else entry.waitingInQueue += Number(row.count);
    byStore.set(row.store_name, entry);
  }

  const logs = (await getAutoUploadLogs(store?.id || null)).slice(0, 5);
  const statusIcon: Record<string, string> = {
    SUCCESS: "✅",
    PARTIAL_SUCCESS: "⚠️",
    FAILED: "❌",
    RESULT_TIMEOUT: "⏳",
    PENDING: "🕒",
    RUNNING: "🔄",
    RETRY_WAIT: "🔁",
    CANCELLED: "🚫",
  };

  return {
    hasData: byStore.size > 0 || logs.length > 0,
    storeName: store?.name || "Tất cả store",
    instructions:
      "Trình bày ngắn gọn: phần 1 'Hàng đợi' (mỗi store 1 dòng: đang chờ upload N | đã áp dụng 7 ngày qua M). Phần 2 '5 job Auto Upload gần nhất' dạng '[icon] [thời gian] - [store] - [số action] action - [trạng thái]'; CHỈ ghi 'Lỗi: ...' khi trường error khác null (không lấy tên file làm lỗi).",
    queue: Array.from(byStore.values()),
    recentJobs: logs.map((log) => ({
      icon: statusIcon[log.status] || "•",
      store: log.storeName || log.adspowerProfileName || "",
      createdAt: log.createdAt,
      fileName: log.fileName,
      actionCount: log.actionCount,
      status: log.status,
      stage: log.stage,
      error: log.errorMessage || log.fileErrorMessage || null,
    })),
  };
}

/**
 * 13. Kết quả sau khi chỉnh bid (theo dõi 3/7/14/30 ngày).
 * Xếp hạng tốt nhất / xấu nhất theo từng lần chỉnh, target, campaign hoặc SKU.
 */
export async function getBidOutcomes(params: {
  storeQuery?: string;
  days?: number;
  label?: "ALL" | "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  sku?: string;
  groupBy?: "ACTION" | "TARGET" | "CAMPAIGN" | "SKU";
  rank?: "RECENT" | "BEST" | "WORST";
  limit?: number;
}) {
  if (!params.storeQuery?.trim()) {
    return { hasData: false, needsStoreClarification: true, message: await storeClarification() };
  }
  const store = await resolvePpcStore(params.storeQuery);
  if (!store) {
    return { hasData: false, message: `Không tìm thấy store "${params.storeQuery}". ${await storeClarification()}` };
  }

  const sql = await getDatabaseClient();
  const days = Math.min(180, Math.max(7, params.days || 60));
  const sku = params.sku?.trim().toUpperCase() || "";

  // Mỗi action lấy cửa sổ dài nhất có kết luận (Tốt / Trung tính / Xấu), sau đó mới tới nhãn khác.
  // EXPORTED (tải file thủ công) và APPLIED (auto upload) đều đã đẩy lên Amazon.
  const rows = await sql<Array<{
    action_id: string;
    sku: string | null;
    target_keyword: string;
    campaign_name: string;
    action_type: string;
    old_value: string | number | null;
    final_value: string | number | null;
    applied_on: string;
    window_days: number | null;
    outcome_label: string | null;
    baseline: Record<string, unknown> | null;
    observed: Record<string, unknown> | null;
    comparison: Record<string, unknown> | null;
  }>>`
    SELECT a.id AS action_id, a.sku, a.target_keyword, a.campaign_name, a.action_type,
           a.old_value, a.final_value,
           COALESCE(a.approved_at, a.created_at)::date::text AS applied_on,
           o.window_days, o.outcome_label, o.baseline, o.observed, o.comparison
    FROM ppc_actions a
    LEFT JOIN LATERAL (
      SELECT window_days, outcome_label, baseline, observed, comparison
      FROM ppc_action_outcomes
      WHERE action_id = a.id
      ORDER BY (outcome_label IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')) IS TRUE DESC,
               (outcome_label IS NOT NULL) DESC, window_days DESC
      LIMIT 1
    ) o ON true
    WHERE a.store_id = ${store.id}
      AND a.action_type IN ('UPDATE_BID', 'PAUSE_TARGET')
      AND a.status IN ('APPLIED', 'EXPORTED')
      AND COALESCE(a.approved_at, a.created_at) >= NOW() - (${days} * INTERVAL '1 day')
      ${sku ? sql`AND UPPER(a.sku) LIKE ${"%" + sku + "%"}` : sql``}
    ORDER BY COALESCE(a.approved_at, a.created_at) DESC
  `;

  const num = (value: unknown) => {
    const n = Number(value);
    return value != null && Number.isFinite(n) ? n : null;
  };
  // Chỉ tin hiệu quả $ của lần chỉnh đã có kết luận; INCONCLUSIVE / INTERRUPTED bỏ qua.
  const decisiveLabels = new Set(["POSITIVE", "NEUTRAL", "NEGATIVE"]);
  const rewardOf = (row: (typeof rows)[number]) =>
    row.outcome_label && decisiveLabels.has(row.outcome_label) ? num(row.comparison?.reward_usd) : null;

  const summary = { total: rows.length, positive: 0, neutral: 0, negative: 0, unclear: 0, observing: 0, rewardUsd: 0 };
  for (const row of rows) {
    if (row.outcome_label === "POSITIVE") summary.positive++;
    else if (row.outcome_label === "NEUTRAL") summary.neutral++;
    else if (row.outcome_label === "NEGATIVE") summary.negative++;
    else if (row.outcome_label) summary.unclear++;
    else summary.observing++;
    summary.rewardUsd += rewardOf(row) ?? 0;
  }
  const decisive = summary.positive + summary.negative;
  const winRate = decisive > 0 ? Math.round((summary.positive / decisive) * 1000) / 10 : null;

  const label = params.label && params.label !== "ALL" ? params.label : null;
  const filtered = label ? rows.filter((row) => row.outcome_label === label) : rows;
  const limit = Math.min(30, Math.max(1, params.limit || 10));
  const rank = params.rank || "RECENT";
  const groupBy = params.groupBy || "ACTION";
  const labelIcon: Record<string, string> = {
    POSITIVE: "🟢 Tốt",
    NEUTRAL: "⚪ Trung tính",
    NEGATIVE: "🔴 Xấu",
    INCONCLUSIVE: "⚫ Không kết luận được",
    INTERRUPTED: "⚫ Bị chỉnh đè trước khi đủ dữ liệu",
  };
  // ACOS trong outcome đã là %, null khi chưa có doanh số.
  const acosOf = (metrics: Record<string, unknown> | null) => {
    const value = num(metrics?.acos);
    return value === null ? null : Math.round(value * 10) / 10;
  };
  const pct = (spend: number, sales: number) => (sales > 0 ? Math.round((spend / sales) * 1000) / 10 : null);
  // Xếp hạng chỉ dùng mục đã có hiệu quả ước tính ($): "tốt nhất" chỉ lấy mục dương, "xấu nhất" chỉ lấy mục âm.
  const sortByRank = <T extends { rewardUsd: number | null }>(list: T[]) =>
    rank === "RECENT"
      ? list
      : list
        .filter((item) => item.rewardUsd !== null && (rank === "BEST" ? item.rewardUsd > 0 : item.rewardUsd < 0))
        .sort((a, b) => (rank === "BEST" ? b.rewardUsd! - a.rewardUsd! : a.rewardUsd! - b.rewardUsd!));
  const emptyRankNote = rank === "RECENT"
    ? ""
    : ` Nếu items rỗng: nói rõ chưa có mục nào ${rank === "BEST" ? "cho hiệu quả dương" : "cho hiệu quả âm"} trong kỳ (chỉ tính lần chỉnh đã có kết luận).`;

  const base = {
    hasData: rows.length > 0,
    storeName: store.name,
    periodDays: days,
    groupBy,
    rank,
    message: rows.length === 0 ? `Chưa có lần chỉnh bid nào đã đẩy lên Amazon trong ${days} ngày qua cho store ${store.name}.` : undefined,
    summary: { ...summary, rewardUsd: money(summary.rewardUsd), winRatePct: winRate },
  };

  if (groupBy === "ACTION") {
    const items = sortByRank(filtered.map((row) => ({ row, rewardUsd: rewardOf(row) }))).slice(0, limit);
    return {
      ...base,
      instructions:
        "Dòng đầu tóm tắt: 'Trong [periodDays] ngày qua: N lần chỉnh bid | 🟢 X tốt | ⚪ Y trung tính | 🔴 Z xấu | ⚫ U không kết luận | ⏳ W đang theo dõi | Tỷ lệ thắng: P% | Hiệu quả ước tính: $R'. Nếu rank=BEST/WORST thì ghi tiêu đề 'Top lần chỉnh tốt nhất/xấu nhất'. Sau đó danh sách đánh số: '[STT]. [result] **[keyword]** (SKU) • $[oldBid] → $[newBid] • ngày [appliedOn] • ACOS [acosBefore]% → [acosAfter]% ([window]) • [rewardUsd]$'. ACOS null thì ghi 'chưa có'." + emptyRankNote,
      items: items.map(({ row, rewardUsd }, idx) => ({
        stt: idx + 1,
        result: row.outcome_label ? labelIcon[row.outcome_label] || row.outcome_label : "⏳ Đang theo dõi",
        sku: row.sku || "N/A",
        keyword: row.target_keyword,
        campaign: row.campaign_name,
        action: row.action_type === "PAUSE_TARGET" ? "Tạm dừng" : "Chỉnh bid",
        oldBid: money(Number(row.old_value)),
        newBid: row.action_type === "PAUSE_TARGET" ? null : money(Number(row.final_value)),
        appliedOn: row.applied_on,
        window: row.window_days ? `${row.window_days} ngày` : "chưa đủ dữ liệu",
        acosBefore: acosOf(row.baseline),
        acosAfter: acosOf(row.observed),
        rewardUsd: rewardUsd === null ? null : money(rewardUsd),
      })),
    };
  }

  const keyOf = (row: (typeof rows)[number]) =>
    groupBy === "TARGET"
      ? `${row.target_keyword}\0${row.campaign_name}`
      : groupBy === "CAMPAIGN"
      ? row.campaign_name
      : (row.sku || "N/A").toUpperCase();
  const groups = new Map<string, {
    name: string;
    campaign: string | null;
    sku: string;
    actions: number;
    positive: number;
    neutral: number;
    negative: number;
    rewardSum: number;
    rewardCount: number;
    beforeSpend: number;
    beforeSales: number;
    afterSpend: number;
    afterSales: number;
    lastAppliedOn: string;
  }>();
  for (const row of filtered) {
    const key = keyOf(row);
    const group = groups.get(key) || {
      name: groupBy === "TARGET" ? row.target_keyword : groupBy === "CAMPAIGN" ? row.campaign_name : (row.sku || "N/A"),
      campaign: groupBy === "TARGET" ? row.campaign_name : null,
      sku: row.sku || "N/A",
      actions: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      rewardSum: 0,
      rewardCount: 0,
      beforeSpend: 0,
      beforeSales: 0,
      afterSpend: 0,
      afterSales: 0,
      lastAppliedOn: row.applied_on,
    };
    group.actions++;
    if (row.outcome_label === "POSITIVE") group.positive++;
    else if (row.outcome_label === "NEUTRAL") group.neutral++;
    else if (row.outcome_label === "NEGATIVE") group.negative++;
    const reward = rewardOf(row);
    if (reward !== null) {
      group.rewardSum += reward;
      group.rewardCount++;
    }
    group.beforeSpend += num(row.baseline?.spend) ?? 0;
    group.beforeSales += num(row.baseline?.sales) ?? 0;
    group.afterSpend += num(row.observed?.spend) ?? 0;
    group.afterSales += num(row.observed?.sales) ?? 0;
    if (row.applied_on > group.lastAppliedOn) group.lastAppliedOn = row.applied_on;
    groups.set(key, group);
  }

  const grouped = sortByRank(
    Array.from(groups.values()).map((group) => ({
      ...group,
      rewardUsd: group.rewardCount > 0 ? group.rewardSum : null,
    })),
  ).slice(0, limit);
  const groupLabel = groupBy === "TARGET" ? "target" : groupBy === "CAMPAIGN" ? "campaign" : "SKU";

  return {
    ...base,
    instructions: `Dòng đầu tóm tắt như mẫu: 'Trong [periodDays] ngày qua: N lần chỉnh bid | 🟢 X tốt | 🔴 Z xấu | Tỷ lệ thắng: P% | Hiệu quả ước tính: $R'. Tiêu đề: 'Top ${groupLabel} ${rank === "WORST" ? "xấu nhất" : rank === "BEST" ? "tốt nhất" : "chỉnh gần đây"} sau khi chỉnh bid'. Danh sách đánh số: '[STT]. **[name]**${groupBy === "TARGET" ? " (Camp: [campaign])" : ""} • [actions] lần chỉnh (🟢 [positive] / 🔴 [negative]) • Hiệu quả: [rewardUsd]$ • ACOS trước [acosBefore]% → sau [acosAfter]%'. ACOS null thì ghi 'chưa có'. Hiệu quả ước tính = lợi nhuận đóng góp thực tế so với kỳ vọng (dương là tốt).${emptyRankNote}`,
    items: grouped.map((group, idx) => ({
      stt: idx + 1,
      name: group.name,
      campaign: group.campaign,
      sku: group.sku,
      actions: group.actions,
      positive: group.positive,
      neutral: group.neutral,
      negative: group.negative,
      rewardUsd: group.rewardUsd === null ? null : money(group.rewardUsd),
      acosBefore: pct(group.beforeSpend, group.beforeSales),
      acosAfter: pct(group.afterSpend, group.afterSales),
      lastAppliedOn: group.lastAppliedOn,
    })),
  };
}

/**
 * 14. AI Review một đề xuất bid (theo STT trong danh sách vừa xem).
 */
export async function reviewBidWithAi(params: { stt: number }, sessionId?: string) {
  if (!sessionId) return { status: "ERROR", message: "Cần phiên hội thoại Lark để chọn đề xuất theo STT." };
  const listed = await getLastBidRecommendations(sessionId);
  const rec = listed[Number(params.stt) - 1];
  if (!rec) {
    return {
      status: "ERROR",
      message: listed.length
        ? `Số thứ tự không hợp lệ. Danh sách hiện có từ 1 đến ${listed.length}.`
        : "Chưa có danh sách đề xuất bid gần đây. Hãy xem danh sách đề xuất Auto Bid trước.",
    };
  }

  const store = await resolvePpcStore(rec.storeName || rec.storeId);
  const review = await reviewPpcRecommendationWithAi(store?.team_id || "default", rec);
  const validation = review.result.validation;
  const raw = review.result.raw_response;
  // Chỉ coi là "bid AI" khi AI thực sự chọn phương án; lỗi gọi AI / fallback thì giữ bid rule.
  const accepted = validation.status === "ACCEPTED_SHADOW" && validation.effective_bid != null && validation.effective_bid > 0;
  const aiBid = accepted ? validation.effective_bid : null;
  if (aiBid != null) await saveAiBid(sessionId, rec.id, aiBid);

  const invocationFailed = (validation.fallback_reason || "").startsWith("INVOCATION_ERROR");
  const verdict = accepted
    ? "AI đưa ra đề xuất riêng"
    : invocationFailed
    ? "Không gọi được dịch vụ AI lúc này, tạm giữ bid theo rule"
    : validation.status === "RULE_FALLBACK"
    ? "AI giữ theo rule (hoặc chưa đủ dữ liệu lịch sử)"
    : "AI trả lời không hợp lệ, giữ bid theo rule";

  return {
    status: "OK",
    stt: params.stt,
    sku: rec.sku || "N/A",
    keyword: rec.keyword,
    action: actionLabel(rec),
    currentBid: money(rec.currentBid),
    ruleBid: rec.recType === "PAUSE_TARGET" ? null : money(rec.recommendedBid),
    aiBid: aiBid != null ? money(aiBid) : null,
    verdict,
    aiDecision: raw?.decision || null,
    analysis: invocationFailed ? null : raw?.analysis || validation.fallback_reason || null,
    ruleDisagreement: raw?.rule_critique?.rule_disagreement ?? false,
    scenario: review.scenario_info?.scenario || null,
    historicalSamples: review.retrieval_metadata.sample_count,
    instructions: `Trình bày ngắn: '🤖 AI Review số ${params.stt}: **[keyword]** (SKU)', dòng 'Bid hiện tại $X | Rule đề xuất $Y | AI đề xuất $Z' (nếu aiBid = null thì ghi 'AI đề xuất: chưa có', TUYỆT ĐỐI KHÔNG lấy bid rule điền vào), dòng 'Nhận định: [verdict]. [analysis rút gọn 1-2 câu]'. Cuối nhắc: nhắn 'Duyệt số ${params.stt} dùng bid AI' để dùng bid AI, hoặc 'Duyệt số ${params.stt}' để giữ bid rule.`,
  };
}

/**
 * 15. Lịch sử chỉnh bid của một target / SKU kèm kết quả.
 */
export async function getTargetBidHistory(
  params: { storeQuery?: string; stt?: number; keyword?: string; sku?: string; limit?: number },
  sessionId?: string,
) {
  let storeId: string | null = null;
  let storeName = "";
  let keyword = params.keyword?.trim() || "";
  let campaignId = "";
  let current: PpcRecommendation | null = null;

  if (params.stt && sessionId) {
    const listed = await getLastBidRecommendations(sessionId);
    current = listed[params.stt - 1] || null;
    if (current) {
      storeId = current.storeId;
      storeName = current.storeName;
      keyword = current.keyword;
      campaignId = current.campaignId || "";
    }
  }
  if (!storeId) {
    if (!params.storeQuery?.trim()) {
      return { hasData: false, needsStoreClarification: true, message: await storeClarification() };
    }
    const store = await resolvePpcStore(params.storeQuery);
    if (!store) return { hasData: false, message: `Không tìm thấy store "${params.storeQuery}".` };
    storeId = store.id;
    storeName = store.name;
  }
  const sku = params.sku?.trim().toUpperCase() || "";
  if (!keyword && !sku) {
    return { hasData: false, message: "Cần STT trong danh sách đề xuất, tên keyword/target hoặc SKU để xem lịch sử." };
  }

  const sql = await getDatabaseClient();
  const limit = Math.min(20, Math.max(1, params.limit || 10));
  const rows = await sql<Array<{
    sku: string | null;
    target_keyword: string;
    campaign_name: string;
    action_type: string;
    old_value: string | number | null;
    final_value: string | number | null;
    status: string;
    approved_by: string | null;
    acted_on: string;
    outcome_label: string | null;
  }>>`
    SELECT a.sku, a.target_keyword, a.campaign_name, a.action_type, a.old_value, a.final_value,
           a.status, a.approved_by, COALESCE(a.approved_at, a.created_at)::date::text AS acted_on,
           (SELECT o.outcome_label FROM ppc_action_outcomes o
             WHERE o.action_id = a.id AND o.outcome_label IS NOT NULL
             ORDER BY (o.outcome_label IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')) DESC, o.window_days DESC
             LIMIT 1) AS outcome_label
    FROM ppc_actions a
    WHERE a.store_id = ${storeId}
      AND a.action_type IN ('UPDATE_BID', 'PAUSE_TARGET')
      AND a.status NOT IN ('SUPERSEDED')
      ${keyword ? sql`AND LOWER(TRIM(a.target_keyword)) = LOWER(TRIM(${keyword}))` : sql``}
      ${campaignId ? sql`AND a.campaign_id = ${campaignId}` : sql``}
      ${sku ? sql`AND UPPER(a.sku) = ${sku}` : sql``}
    ORDER BY COALESCE(a.approved_at, a.created_at) DESC
    LIMIT ${limit}
  `;

  const statusText: Record<string, string> = {
    APPLIED: "Đã áp dụng",
    EXPORTED: "Đã xuất file",
    APPROVED: "Chờ upload",
    QUEUED: "Chờ upload",
    PENDING: "Chờ duyệt",
    IGNORED: "Đã bỏ qua",
    DISMISSED: "Đã bỏ",
  };
  const labelIcon: Record<string, string> = {
    POSITIVE: "🟢 Tốt",
    NEUTRAL: "⚪ Trung tính",
    NEGATIVE: "🔴 Xấu",
    INCONCLUSIVE: "⚫ Không kết luận được",
    INTERRUPTED: "⚫ Bị chỉnh đè",
  };

  return {
    hasData: rows.length > 0,
    storeName,
    target: keyword || null,
    sku: sku || current?.sku || null,
    message: rows.length === 0 ? "Target/SKU này chưa từng được chỉnh bid qua hệ thống." : undefined,
    currentMetrics: current
      ? {
        currentBid: money(current.currentBid),
        clicks: Number(current.clicks || 0),
        orders: Number(current.orders || 0),
        spend: money(current.spend),
        sales: money(current.sales),
        acos: current.sales && Number(current.sales) > 0 ? Math.round((Number(current.spend || 0) / Number(current.sales)) * 1000) / 10 : null,
        windowDays: 30,
      }
      : null,
    instructions:
      "Nếu có currentMetrics thì dòng đầu: 'Hiện tại (30 ngày): bid $X | Clicks N | Orders N | Spend $X | ACOS Y%'. Sau đó dòng thời gian mới nhất trước: '[actedOn] • [action] $[oldBid] → $[newBid] • [status] • [result] • bởi [by]'.",
    history: rows.map((row) => ({
      actedOn: row.acted_on,
      sku: row.sku || "N/A",
      keyword: row.target_keyword,
      action: row.action_type === "PAUSE_TARGET" ? "Tạm dừng" : "Chỉnh bid",
      oldBid: money(Number(row.old_value)),
      newBid: row.action_type === "PAUSE_TARGET" ? null : money(Number(row.final_value)),
      status: statusText[row.status] || row.status,
      result: row.outcome_label
        ? labelIcon[row.outcome_label] || row.outcome_label
        : row.status === "APPLIED" || row.status === "EXPORTED" ? "⏳ Đang theo dõi" : "-",
      by: row.approved_by || "N/A",
    })),
  };
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * 16. Tình hình một SKU: hiện tại, xu hướng theo tuần, đề xuất bid đang có và gợi ý hành động.
 * Số kế toán lấy từ cùng hàm với bảng Lọc SKU (listSkuWin) nên khớp với web.
 */
export async function getSkuInsight(
  params: { storeQuery?: string; sku?: string; days?: number },
  sessionId?: string,
) {
  if (!params.storeQuery?.trim()) {
    return { hasData: false, needsStoreClarification: true, message: await storeClarification() };
  }
  const sku = params.sku?.trim().toUpperCase();
  if (!sku) return { hasData: false, message: "Vui lòng cho biết mã SKU cần xem." };
  const store = await resolvePpcStore(params.storeQuery);
  if (!store) {
    return { hasData: false, message: `Không tìm thấy store "${params.storeQuery}". ${await storeClarification()}` };
  }
  const accounting = await getAccountingStoreForPpcStore(store.id);
  const sql = await getDatabaseClient();
  const days = Math.min(30, Math.max(7, params.days || 14));

  const master = accounting
    ? (await sql<Array<{ sku: string; status: string | null; product_type: string | null; asin: string | null }>>`
        SELECT sku, status, product_type, asin FROM accounting_sku_master
        WHERE store_id = ${accounting.accountingStoreId} AND UPPER(sku) = ${sku} AND deleted_at IS NULL
        LIMIT 1
      `)[0]
    : undefined;

  // Kỳ hiện tại kết thúc ở ngày gần nhất đã có đơn (dữ liệu kế toán chốt đến hôm qua).
  const latestRows = accounting
    ? await sql<Array<{ latest: string | null }>>`
        SELECT MAX(date)::text AS latest FROM accounting_orders
        WHERE store_id = ${accounting.accountingStoreId} AND date < CURRENT_DATE
      `
    : [];
  const endDate = latestRows[0]?.latest || shiftDate(new Date().toISOString().slice(0, 10), -1);
  const startDate = shiftDate(endDate, -(days - 1));
  const prevEnd = shiftDate(startDate, -1);
  const prevStart = shiftDate(prevEnd, -(days - 1));

  const periodMetrics = async (from: string, to: string) => {
    if (!accounting) return null;
    const result = await listSkuWin(accounting.accountingStoreId, {
      status: "all",
      search: sku,
      startDate: from,
      endDate: to,
      limit: 1000,
    });
    const item = result.items.find((it) => it.sku.toUpperCase() === sku);
    if (!item) return null;
    return {
      revenue: money(item.revenue),
      units: item.quantity,
      adsSpend: money(item.ads_fee),
      adsSales: money(item.revenue_ads),
      profit: money(item.profit),
      marginPct: Math.round(item.margin * 1000) / 10,
      tacosPct: Math.round(item.tacos * 1000) / 10,
      acosPct: item.revenue_ads > 0 ? Math.round((item.ads_fee / item.revenue_ads) * 1000) / 10 : null,
      returns: item.return_count,
    };
  };

  const [current, previous, economicsList, grouped] = await Promise.all([
    periodMetrics(startDate, endDate),
    periodMetrics(prevStart, prevEnd),
    getSkuEconomicsList(store.id, RECOMMENDATION_WINDOW_DAYS).catch(() => []),
    loadGroupedRecommendations(store).catch(() => null),
  ]);
  const economics = economicsList.find((e) => e.sku.toUpperCase() === sku);

  // Xu hướng 4 tuần gần nhất, tuần cuối kết thúc ở endDate. Cùng điều kiện với Lọc SKU (listSkuWin):
  // units/revenue từ đơn FBA không hủy, ads theo portfolio chứa SKU.
  const trendStart = shiftDate(endDate, -27);
  const weekly = accounting
    ? await sql<Array<{ week: number; units: string; revenue: string; ads_spend: string; ads_sales: string }>>`
        WITH orders AS (
          SELECT ((${endDate}::date - date) / 7) AS week,
                 SUM(COALESCE(quantity, 1)) AS units,
                 SUM(COALESCE(item_price, 0) * CASE currency WHEN 'CAD' THEN 0.738 WHEN 'MXN' THEN 0.051 WHEN 'USD' THEN 1.0 ELSE 0 END) AS revenue
          FROM accounting_orders
          WHERE store_id = ${accounting.accountingStoreId} AND UPPER(sku) = ${sku}
            AND fulfillment_channel = 'Amazon'
            AND (currency IN ('USD', 'CAD', 'MXN') OR amazon_order_id LIKE 'S0%')
            AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
            AND date BETWEEN ${trendStart}::date AND ${endDate}::date
          GROUP BY 1
        ),
        ads AS (
          SELECT ((${endDate}::date - date) / 7) AS week, SUM(spend) AS ads_spend, SUM(sales) AS ads_sales
          FROM accounting_ads
          WHERE store_id = ${accounting.accountingStoreId}
            AND strpos(LOWER(portfolio), LOWER(${sku})) > 0
            AND date BETWEEN ${trendStart}::date AND ${endDate}::date
          GROUP BY 1
        )
        SELECT w.week,
               COALESCE(o.units, 0)::text AS units, COALESCE(o.revenue, 0)::text AS revenue,
               COALESCE(a.ads_spend, 0)::text AS ads_spend, COALESCE(a.ads_sales, 0)::text AS ads_sales
        FROM generate_series(0, 3) AS w(week)
        LEFT JOIN orders o ON o.week = w.week
        LEFT JOIN ads a ON a.week = w.week
        ORDER BY w.week DESC
      `
    : [];

  // Search term 30 ngày của SKU: đốt tiền (>= 10 click, 0 đơn) và ra đơn tốt (>= 2 đơn).
  const termRows = await sql<Array<{ waste_terms: number; waste_spend: string; sale_terms: number }>>`
    WITH terms AS (
      SELECT LOWER(TRIM(customer_search_term)) AS term,
             SUM(clicks) AS clicks, SUM(orders) AS orders, SUM(spend) AS spend
      FROM ppc_search_terms
      WHERE store_id = ${store.id} AND UPPER(sku) = ${sku}
        AND report_granularity = 'DAILY'
        AND report_end_date >= CURRENT_DATE - 30
      GROUP BY 1
    )
    SELECT COUNT(*) FILTER (WHERE orders = 0 AND clicks >= 10)::int AS waste_terms,
           COALESCE(SUM(spend) FILTER (WHERE orders = 0 AND clicks >= 10), 0)::text AS waste_spend,
           COUNT(*) FILTER (WHERE orders >= 2)::int AS sale_terms
    FROM terms
  `;
  const terms = {
    wasteTerms: termRows[0]?.waste_terms ?? 0,
    wasteSpend: money(Number(termRows[0]?.waste_spend || 0)),
    saleTerms: termRows[0]?.sale_terms ?? 0,
  };

  const skuRecs = (grouped?.allRecommendations || [])
    .filter((r) => (r.sku || "").toUpperCase() === sku)
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  const recCounts = {
    increase: skuRecs.filter((r) => r.recType === "BID_INCREASE").length,
    decrease: skuRecs.filter((r) => r.recType === "BID_DECREASE").length,
    pause: skuRecs.filter((r) => r.recType === "PAUSE_TARGET").length,
  };
  const topRecs = skuRecs.slice(0, 5);
  // Lưu để người dùng nhắn tiếp "duyệt số 1" như danh sách Auto Bid; không có đề xuất thì xóa danh sách cũ
  // để "duyệt số 1" không trỏ nhầm sang danh sách trước đó.
  if (sessionId) await setLastBidRecommendations(sessionId, topRecs);

  if (!current && !economics && skuRecs.length === 0) {
    return { hasData: false, message: `Không tìm thấy dữ liệu cho SKU ${sku} ở store ${store.name}.` };
  }

  // Gợi ý hành động theo quy tắc cố định (không đoán): ACOS so với hòa vốn, xu hướng, search term.
  const suggestions: string[] = [];
  const ppcAcos = economics && Number(economics.sales || 0) > 0 ? Number(economics.acos || 0) : null;
  const breakEven = economics?.breakEvenAcos ?? null;
  if (current && current.profit < 0) {
    suggestions.push(`🔴 SKU đang lỗ $${Math.abs(current.profit).toFixed(2)} trong ${days} ngày gần nhất: ưu tiên cắt chi phí ads.`);
  }
  if (ppcAcos !== null && breakEven !== null && ppcAcos > breakEven) {
    suggestions.push(`🔴 ACOS ads 30 ngày ${ppcAcos.toFixed(1)}% vượt hòa vốn ${breakEven.toFixed(1)}%: giảm bid${recCounts.decrease ? ` (${recCounts.decrease} đề xuất giảm)` : ""}${terms.wasteTerms ? `, phủ định ${terms.wasteTerms} search term đốt $${terms.wasteSpend}` : ""}.`);
  } else if (ppcAcos !== null && breakEven !== null && ppcAcos < breakEven * 0.7 && Number(economics?.orders || 0) >= 3) {
    suggestions.push(`🟢 ACOS ads ${ppcAcos.toFixed(1)}% thấp hơn nhiều so với hòa vốn ${breakEven.toFixed(1)}%: còn dư địa scale${recCounts.increase ? ` (${recCounts.increase} đề xuất tăng bid)` : ""}${terms.saleTerms ? `, có ${terms.saleTerms} search term ra đơn có thể lên camp Sale KW` : ""}.`);
  }
  if (terms.wasteTerms > 0 && !(ppcAcos !== null && breakEven !== null && ppcAcos > breakEven)) {
    suggestions.push(`🎯 Có ${terms.wasteTerms} search term nhiều click không ra đơn (đốt $${terms.wasteSpend}): nên xem phủ định.`);
  }
  if (recCounts.pause > 0) suggestions.push(`⏸️ ${recCounts.pause} target nên tạm dừng theo rule.`);
  if (current && previous) {
    const revenueChange = changePct(current.revenue, previous.revenue);
    const spendChange = changePct(current.adsSpend, previous.adsSpend);
    if (revenueChange !== null && revenueChange <= -20) {
      suggestions.push(`🔻 Revenue giảm ${Math.abs(revenueChange)}% so với ${days} ngày trước: kiểm tra tồn kho, giá, listing và vị trí từ khóa chính.`);
    }
    if (spendChange !== null && revenueChange !== null && spendChange >= 30 && revenueChange < 10) {
      suggestions.push(`⚠️ Chi ads tăng ${spendChange}% nhưng Revenue chỉ ${revenueChange >= 0 ? "+" : ""}${revenueChange}%: ads đang kém hiệu quả dần.`);
    }
  }
  if (suggestions.length === 0) suggestions.push("✅ Chưa thấy tín hiệu bất thường: giữ nguyên, theo dõi tiếp.");

  const weekLabels = ["3 tuần trước", "2 tuần trước", "Tuần trước", "7 ngày gần nhất"];
  return {
    hasData: true,
    storeName: store.name,
    sku,
    status: master?.status || economics?.skuStatus || null,
    productType: master?.product_type || economics?.productType || null,
    asin: master?.asin || economics?.asin || null,
    period: { current: `${startDate} → ${endDate}`, previous: `${prevStart} → ${prevEnd}`, days },
    current,
    previous,
    change: current && previous
      ? {
        revenuePct: changePct(current.revenue, previous.revenue),
        unitsPct: changePct(current.units, previous.units),
        adsSpendPct: changePct(current.adsSpend, previous.adsSpend),
        profitPct: changePct(current.profit, previous.profit),
      }
      : null,
    weeklyTrend: weekly.map((w, idx) => {
      const adsSpend = Number(w.ads_spend);
      const adsSales = Number(w.ads_sales);
      return {
        week: weekLabels[idx] || `Tuần ${idx + 1}`,
        units: Number(w.units),
        revenue: money(Number(w.revenue)),
        adsSpend: money(adsSpend),
        acosPct: adsSales > 0 ? Math.round((adsSpend / adsSales) * 1000) / 10 : null,
      };
    }),
    ppc30d: economics
      ? {
        spend: money(economics.spend),
        sales: money(economics.sales),
        orders: Number(economics.orders || 0),
        clicks: Number(economics.clicks || 0),
        acosPct: ppcAcos,
        breakEvenAcosPct: breakEven,
        maxBid: money(economics.maxBid),
        profitBeforeAdsPerUnit: money(economics.profitBeforeAds),
      }
      : null,
    searchTerms30d: terms,
    bidRecommendations: {
      ...recCounts,
      top: topRecs.map((r, idx) => ({
        stt: idx + 1,
        action: actionLabel(r),
        keyword: r.keyword,
        currentBid: money(r.currentBid),
        newBid: r.recType === "PAUSE_TARGET" ? null : money(r.recommendedBid),
        clicks: Number(r.clicks || 0),
        orders: Number(r.orders || 0),
        spend: money(r.spend),
      })),
    },
    suggestions,
    instructions: `Trình bày gọn theo 4 phần, KHÔNG dùng bảng ngang nhiều cột:
1) '📦 SKU [sku] ([productType], trạng thái [status]) – [storeName]'
2) '📊 Hiện tại ([period.current])': Revenue, Units, Ads Spend, ACOS, TACOS, Profit, Margin; mỗi chỉ số kèm % so với kỳ trước (🔺/🔻) nếu có change.
3) '📈 Xu hướng 4 tuần': mỗi tuần 1 dòng 'tuần: [units] units | $[revenue] | Ads $[adsSpend] | ACOS [acosPct]%'.
4) '💡 Nên làm gì': liệt kê suggestions; nếu bidRecommendations.top có dữ liệu thì liệt kê ngắn (STT. action keyword $cũ → $mới) và nhắc 'nhắn Duyệt số 1, 2 để tạo yêu cầu chỉnh bid'.
ACOS / chỉ số null thì ghi 'chưa có'.`,
  };
}
