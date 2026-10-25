import "server-only";

import { getReadyRedisClient, getRedisClient } from "@/lib/redis";
import type { PpcRecommendation } from "@/lib/ppc/types";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const MEMORY_TTL_SECONDS = 1800; // 30 phút
const MAX_HISTORY_TURNS = 6; // Lưu tối đa 6 lượt gần nhất (3 cặp hỏi - đáp)

// In-memory fallback map nếu Redis không khả dụng
const inMemoryStore = new Map<string, { turns: ConversationTurn[]; expiresAt: number }>();

function cleanupInMemory() {
  const now = Date.now();
  for (const [key, val] of inMemoryStore.entries()) {
    if (val.expiresAt <= now) {
      inMemoryStore.delete(key);
    }
  }
}

/**
 * Lấy lịch sử hội thoại gần đây theo sessionId (chatId hoặc userId)
 */
export async function getConversationHistory(sessionId: string): Promise<ConversationTurn[]> {
  if (!sessionId) return [];
  const redis = getRedisClient();

  if (redis) {
    try {
      const data = await redis.get(`lark:ai:history:${sessionId}`);
      if (data) {
        return JSON.parse(data) as ConversationTurn[];
      }
    } catch (err) {
      console.warn("[LarkMemory] Redis read error, using in-memory fallback:", err);
    }
  }

  // Fallback in-memory
  cleanupInMemory();
  const entry = inMemoryStore.get(sessionId);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.turns;
  }
  return [];
}

/**
 * Lưu thêm một cặp hỏi - đáp vào lịch sử với thời hạn 30 phút
 */
export async function saveConversationTurn(
  sessionId: string,
  userMessage: string,
  assistantReply: string
): Promise<void> {
  if (!sessionId) return;
  const now = Date.now();

  const history = await getConversationHistory(sessionId);
  history.push({ role: "user", content: userMessage, timestamp: now });
  history.push({ role: "assistant", content: assistantReply, timestamp: now });

  // Giới hạn số lượng tin nhắn gần nhất
  const trimmed = history.slice(-MAX_HISTORY_TURNS);

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(
        `lark:ai:history:${sessionId}`,
        MEMORY_TTL_SECONDS,
        JSON.stringify(trimmed)
      );
      return;
    } catch (err) {
      console.warn("[LarkMemory] Redis write error, using in-memory fallback:", err);
    }
  }

  // Fallback in-memory
  inMemoryStore.set(sessionId, {
    turns: trimmed,
    expiresAt: now + MEMORY_TTL_SECONDS * 1000,
  });
}

export interface PendingNegativeItem {
  storeId?: string;
  storeName?: string;
  keyword: string;
  campaignName: string;
  campaignId?: string;
  adGroupName?: string;
  adGroupId?: string;
  adType?: string;
  clicks?: number;
  spend?: number;
  matchType?: string;
  reason?: string;
}

export interface PendingSaleKwItem {
  storeId?: string;
  storeName?: string;
  keyword: string;
  sku: string;
  orders: number;
  clicks: number;
  spend: number;
  sales: number;
  cpc?: number;
  bid?: number;
  sourceCampaignName?: string;
  sourceCampaignId?: string;
  sourceAdGroupId?: string;
  sourceAdGroupName?: string;
}

export interface PendingBidItem {
  recommendation: PpcRecommendation;
  finalBid: number | null; // null = pause target
  bidSource: "RULE_ENGINE" | "USER_EDIT" | "AI_AGENT";
}

export interface PendingPpcAction {
  action: "NEGATIVE_KEYWORD" | "LAUNCH_SALE_KW" | "AUTO_BID";
  storeId: string;
  storeName: string;
  // Dành cho NEGATIVE_KEYWORD
  campaignName?: string;
  keyword?: string; // Tương thích ngược với 1 từ khóa
  matchType?: string;
  reason?: string;
  items?: PendingNegativeItem[]; // Hỗ trợ 1 hoặc nhiều từ khóa cùng lúc
  // Dành cho LAUNCH_SALE_KW
  saleKwItems?: PendingSaleKwItem[];
  campaignTriads?: Array<{ sku: string; exact: string; phrase: string; broad: string; keywordsCount: number }>;
  dailyBudget?: number;
  defaultBid?: number;
  userName?: string;
  dateStr?: string;
  negateInSource?: boolean;
  // Dành cho AUTO_BID
  bidItems?: PendingBidItem[];
  createdAt: number;
}

const PENDING_ACTION_TTL_SECONDS = 900; // 15 phút chờ xác nhận
const inMemoryPendingActions = new Map<string, { action: PendingPpcAction; expiresAt: number }>();

// Cache danh sách Search Terms vừa gợi ý gần đây nhất để hỗ trợ người dùng chọn theo STT (ví dụ: "phủ định từ số 1, 3")
const inMemoryCandidateCache = new Map<string, { items: PendingNegativeItem[]; expiresAt: number }>();
const inMemorySaleKwCache = new Map<string, { items: PendingSaleKwItem[]; expiresAt: number }>();
const inMemoryBidRecCache = new Map<string, { items: PpcRecommendation[]; expiresAt: number }>();

/**
 * Lưu danh sách đề xuất Auto Bid vừa hiển thị để người dùng chọn theo STT
 */
export async function setLastBidRecommendations(sessionId: string, items: PpcRecommendation[]): Promise<void> {
  if (!sessionId) return;
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(`lark:last_bid_recs:${sessionId}`, PENDING_ACTION_TTL_SECONDS, JSON.stringify(items));
      return;
    } catch (err) {
      console.warn("[LarkMemory] Redis setLastBidRecommendations error:", err);
    }
  }

  inMemoryBidRecCache.set(sessionId, {
    items,
    expiresAt: Date.now() + PENDING_ACTION_TTL_SECONDS * 1000,
  });
}

/**
 * Lấy danh sách đề xuất Auto Bid vừa hiển thị
 */
export async function getLastBidRecommendations(sessionId: string): Promise<PpcRecommendation[]> {
  if (!sessionId) return [];
  const redis = getRedisClient();
  if (redis) {
    try {
      const data = await redis.get(`lark:last_bid_recs:${sessionId}`);
      if (data) return JSON.parse(data) as PpcRecommendation[];
    } catch (err) {
      console.warn("[LarkMemory] Redis getLastBidRecommendations error:", err);
    }
  }

  const cached = inMemoryBidRecCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  return [];
}

/**
 * Lưu danh sách Search Terms vừa gợi ý để hỗ trợ người dùng chọn theo STT
 */
export async function setLastListedCandidates(sessionId: string, items: PendingNegativeItem[]): Promise<void> {
  if (!sessionId) return;
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(
        `lark:last_candidates:${sessionId}`,
        PENDING_ACTION_TTL_SECONDS,
        JSON.stringify(items)
      );
      return;
    } catch (err) {
      console.warn("[LarkMemory] Redis setLastListedCandidates error:", err);
    }
  }

  inMemoryCandidateCache.set(sessionId, {
    items,
    expiresAt: Date.now() + PENDING_ACTION_TTL_SECONDS * 1000,
  });
}

/**
 * Lấy danh sách Search Terms vừa gợi ý gần đây nhất
 */
export async function getLastListedCandidates(sessionId: string): Promise<PendingNegativeItem[]> {
  if (!sessionId) return [];
  const redis = getRedisClient();
  if (redis) {
    try {
      const data = await redis.get(`lark:last_candidates:${sessionId}`);
      if (data) {
        return JSON.parse(data) as PendingNegativeItem[];
      }
    } catch (err) {
      console.warn("[LarkMemory] Redis getLastListedCandidates error:", err);
    }
  }

  const cached = inMemoryCandidateCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }
  return [];
}

/**
 * Lưu danh sách Sale KW Search Terms vừa gợi ý để chọn theo STT
 */
export async function setLastSaleKwCandidates(sessionId: string, items: PendingSaleKwItem[]): Promise<void> {
  if (!sessionId) return;
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(
        `lark:last_sale_kw:${sessionId}`,
        PENDING_ACTION_TTL_SECONDS,
        JSON.stringify(items)
      );
      return;
    } catch (err) {
      console.warn("[LarkMemory] Redis setLastSaleKwCandidates error:", err);
    }
  }

  inMemorySaleKwCache.set(sessionId, {
    items,
    expiresAt: Date.now() + PENDING_ACTION_TTL_SECONDS * 1000,
  });
}

/**
 * Lấy danh sách Sale KW Search Terms vừa gợi ý
 */
export async function getLastSaleKwCandidates(sessionId: string): Promise<PendingSaleKwItem[]> {
  if (!sessionId) return [];
  const redis = getRedisClient();
  if (redis) {
    try {
      const data = await redis.get(`lark:last_sale_kw:${sessionId}`);
      if (data) {
        return JSON.parse(data) as PendingSaleKwItem[];
      }
    } catch (err) {
      console.warn("[LarkMemory] Redis getLastSaleKwCandidates error:", err);
    }
  }

  const cached = inMemorySaleKwCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }
  return [];
}

/**
 * Lưu trạng thái thao tác đang chờ người dùng bấm nút / nhắn tin xác nhận
 */
export async function setPendingAction(sessionId: string, action: PendingPpcAction): Promise<void> {
  if (!sessionId) return;
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(
        `lark:pending_action:${sessionId}`,
        PENDING_ACTION_TTL_SECONDS,
        JSON.stringify(action)
      );
      return;
    } catch (err) {
      console.warn("[LarkMemory] Redis setPendingAction error, using in-memory:", err);
    }
  }

  inMemoryPendingActions.set(sessionId, {
    action,
    expiresAt: Date.now() + PENDING_ACTION_TTL_SECONDS * 1000,
  });
}

/**
 * Lấy thao tác đang chờ xác nhận của phiên hội thoại
 */
export async function getPendingAction(sessionId: string): Promise<PendingPpcAction | null> {
  if (!sessionId) return null;
  const redis = getRedisClient();
  if (redis) {
    try {
      const data = await redis.get(`lark:pending_action:${sessionId}`);
      if (data) {
        return JSON.parse(data) as PendingPpcAction;
      }
    } catch (err) {
      console.warn("[LarkMemory] Redis getPendingAction error, using in-memory:", err);
    }
  }

  const item = inMemoryPendingActions.get(sessionId);
  if (item && item.expiresAt > Date.now()) {
    return item.action;
  }
  return null;
}

/**
 * Xóa thao tác chờ xác nhận sau khi đã thực thi hoặc hủy bỏ
 */
export async function clearPendingAction(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(`lark:pending_action:${sessionId}`);
    } catch (err) {
      console.warn("[LarkMemory] Redis clearPendingAction error:", err);
    }
  }
  inMemoryPendingActions.delete(sessionId);
}

/**
 * Giành quyền thực thi thao tác chờ: xóa nguyên tử, chỉ một lần xác nhận (bấm nút 2 lần, Lark gửi lại sự kiện) được chạy.
 */
export async function claimPendingAction(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const redis = getRedisClient();
  if (redis) {
    try {
      const deleted = await redis.del(`lark:pending_action:${sessionId}`);
      inMemoryPendingActions.delete(sessionId);
      return deleted > 0;
    } catch (err) {
      console.warn("[LarkMemory] Redis claimPendingAction error, using in-memory:", err);
    }
  }
  return inMemoryPendingActions.delete(sessionId);
}

// In-memory map để deduplicate tin nhắn tránh race condition & lặp lại
const inMemoryProcessedMessages = new Map<string, number>();

/**
 * Kiểm tra và đánh dấu message_id đã xử lý hay chưa (tránh spam / duplicate events)
 * @returns true nếu là tin nhắn TRÙNG LẶP (đã xử lý trong vòng 10 phút), false nếu là tin nhắn mới
 */
export async function checkAndMarkMessageProcessed(messageId: string): Promise<boolean> {
  if (!messageId) return false;

  const now = Date.now();

  // 1. KIỂM TRA & ĐÁNH DẤU ĐỒNG BỘ (SYNCHRONOUS) NGAY LẬP TỨC TRƯỚC BẤT KỲ AWAIT NÀO!
  // Vì Node.js là đơn luồng (single-thread), thao tác đồng bộ này loại bỏ 100% race-condition khi 2 event đến cùng 1 mili-giây.
  if (inMemoryProcessedMessages.has(messageId)) {
    return true; // Đã thấy ID này -> TRÙNG LẶP 100%
  }
  inMemoryProcessedMessages.set(messageId, now);

  // Dọn dẹp map nếu quá lớn
  if (inMemoryProcessedMessages.size > 2000) {
    for (const [id, ts] of inMemoryProcessedMessages.entries()) {
      if (now - ts > 600000) inMemoryProcessedMessages.delete(id);
    }
  }

  // 2. Luôn chờ lần kết nối Redis ban đầu hoàn tất. Webhook và WSS có thể là
  // hai process khác nhau, nên chỉ dựa vào Map trong process sẽ vẫn trả lời đôi.
  const redis = await getReadyRedisClient();
  if (redis) {
    try {
      const res = await redis.set(`lark:msg_dedup:${messageId}`, "1", "EX", 600, "NX");
      if (res === null) {
        return true;
      }
    } catch {
      // Redis warning ignored, already locked in-memory above
    }
  }

  return false;
}

