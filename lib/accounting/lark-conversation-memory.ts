import "server-only";

import { getRedisClient } from "@/lib/redis";

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
