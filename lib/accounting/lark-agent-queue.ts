import "server-only";

import { randomUUID } from "node:crypto";
import { getReadyRedisClient } from "@/lib/redis";

export const LARK_AGENT_QUEUE_KEY = "lark:agent:jobs:ready";
export const LARK_AGENT_PROCESSING_KEY = "lark:agent:jobs:processing";
export const LARK_AGENT_FAILED_KEY = "lark:agent:jobs:failed";

export interface LarkAgentJob {
  id: string;
  message: string;
  receiveId: string;
  receiveIdType: "email" | "chat_id" | "open_id";
  sessionId: string;
  /** Original Lark message to reply to, so answers stay attached to the asker. */
  replyToMessageId?: string;
  /** When the user sent the Lark message (ms). Stale jobs are dropped by the worker. */
  messageCreatedAt?: number;
  createdAt: number;
  attempts: number;
}

export type NewLarkAgentJob = Pick<
  LarkAgentJob,
  "message" | "receiveId" | "receiveIdType" | "sessionId" | "replyToMessageId" | "messageCreatedAt"
>;

const DEFAULT_MAX_MESSAGE_AGE_MINUTES = 30;

/** Messages older than this are never answered (Lark keeps retrying failed deliveries for hours). */
export function larkMessageMaxAgeMs(): number {
  const minutes = Number(process.env.LARK_AGENT_MAX_MESSAGE_AGE_MINUTES || DEFAULT_MAX_MESSAGE_AGE_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MAX_MESSAGE_AGE_MINUTES) * 60_000;
}

export function isStaleLarkMessage(messageCreatedAt: number | undefined, now = Date.now()): boolean {
  return typeof messageCreatedAt === "number" && messageCreatedAt > 0 && now - messageCreatedAt > larkMessageMaxAgeMs();
}

export async function enqueueLarkAgentJob(input: NewLarkAgentJob): Promise<LarkAgentJob> {
  const redis = await getReadyRedisClient();
  if (!redis) throw new Error("Redis chưa sẵn sàng để nhận Lark agent job.");

  const job: LarkAgentJob = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
  };

  // LPUSH + BRPOPLPUSH gives FIFO delivery while atomically moving claimed
  // jobs to the processing list for crash recovery.
  await redis.lpush(LARK_AGENT_QUEUE_KEY, JSON.stringify(job));
  return job;
}

export async function enqueueLarkAgentJobOnce(
  dedupKey: string,
  input: NewLarkAgentJob,
  // Lark retries failed deliveries for many hours, so remember message ids for a day.
  dedupTtlSeconds = 24 * 60 * 60,
): Promise<{ job: LarkAgentJob; enqueued: boolean }> {
  const redis = await getReadyRedisClient();
  if (!redis) throw new Error("Redis chưa sẵn sàng để nhận Lark agent job.");

  const job: LarkAgentJob = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
  };
  const raw = JSON.stringify(job);
  const key = `lark:msg_dedup:${dedupKey}`;

  // Claiming the callback and adding its job must be one atomic operation.
  // Otherwise a Redis error between SET NX and LPUSH would permanently drop it.
  const result = await redis.eval(
    `if redis.call("EXISTS", KEYS[1]) == 1 then
       return 0
     end
     redis.call("SET", KEYS[1], "1", "EX", ARGV[1])
     redis.call("LPUSH", KEYS[2], ARGV[2])
     return 1`,
    2,
    key,
    LARK_AGENT_QUEUE_KEY,
    String(dedupTtlSeconds),
    raw,
  );

  return { job, enqueued: Number(result) === 1 };
}

export function parseLarkAgentJob(raw: string): LarkAgentJob {
  const job = JSON.parse(raw) as Partial<LarkAgentJob>;
  if (
    !job.id || !job.message || !job.receiveId || !job.sessionId ||
    !["email", "chat_id", "open_id"].includes(job.receiveIdType || "")
  ) {
    throw new Error("Lark agent job không hợp lệ.");
  }
  return job as LarkAgentJob;
}
