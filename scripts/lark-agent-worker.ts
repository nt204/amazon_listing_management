import os from "node:os";
import Redis from "ioredis";
import { runAccountingAgent } from "../lib/accounting/lark-agent-service";
import {
  addLarkMessageReaction,
  getLarkMessageCreatedAt,
  sendLarkTextNotification,
} from "../lib/lark-notifications";
import {
  LARK_AGENT_FAILED_KEY,
  LARK_AGENT_PROCESSING_KEY,
  LARK_AGENT_QUEUE_KEY,
  isStaleLarkMessage,
  type LarkAgentJob,
  parseLarkAgentJob,
} from "../lib/accounting/lark-agent-queue";

const concurrency = Math.max(1, Math.min(10, Number(process.env.LARK_AGENT_CONCURRENCY || 4)));
const maxAttempts = Math.max(1, Number(process.env.LARK_AGENT_MAX_ATTEMPTS || 3));
const redisUrl = process.env.REDIS_URL || "redis://localhost:2413";
const ackEmoji = process.env.LARK_AGENT_ACK_EMOJI?.trim() || "OnIt";
const workerId = `${os.hostname()}:${process.pid}`;
const activeSessions = new Set<string>();
const pending: Array<{ raw: string; job: LarkAgentJob }> = [];
let activeCount = 0;
let stopping = false;

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  connectTimeout: 5_000,
  enableOfflineQueue: true,
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverInterruptedJobs() {
  let recovered = 0;
  while (true) {
    const raw = await redis.rpoplpush(LARK_AGENT_PROCESSING_KEY, LARK_AGENT_QUEUE_KEY);
    if (!raw) break;
    recovered += 1;
  }
  if (recovered > 0) console.warn(`[LarkAgentWorker] Khôi phục ${recovered} job bị gián đoạn.`);
}

async function finishRaw(raw: string) {
  await redis.lrem(LARK_AGENT_PROCESSING_KEY, 1, raw);
}

async function processJob(raw: string, job: LarkAgentJob) {
  const startedAt = Date.now();
  // Jobs queued by an older webhook build carry no timestamp; ask Lark.
  if (!job.messageCreatedAt && job.replyToMessageId) {
    job.messageCreatedAt = (await getLarkMessageCreatedAt(job.replyToMessageId).catch(() => null)) ?? undefined;
  }
  // A job can sit in the queue (worker down, backlog); never answer a question
  // the user asked long ago.
  if (isStaleLarkMessage(job.messageCreatedAt, startedAt)) {
    await finishRaw(raw);
    console.warn(`[LarkAgentWorker] Bỏ qua job cũ ${job.id} (message ${job.replyToMessageId || "unknown"}).`);
    activeSessions.delete(job.sessionId);
    activeCount -= 1;
    return;
  }
  try {
    console.info(
      `[LarkAgentWorker] Start ${job.id} session=${job.sessionId} attempt=${job.attempts + 1}`,
    );
    // The LLM needs several seconds; react right away so the asker knows the
    // bot is on it. Best-effort and not awaited, so it never delays the answer.
    if (job.replyToMessageId && job.attempts === 0) {
      void addLarkMessageReaction(job.replyToMessageId, ackEmoji).catch((error) => {
        console.warn(`[LarkAgentWorker] Không thả được reaction ${job.id}:`, error?.message || error);
      });
    }
    await runAccountingAgent({
      message: job.message,
      receiveId: job.receiveId,
      receiveIdType: job.receiveIdType,
      sessionId: job.sessionId,
      larkSenderId: job.larkSenderId,
      replyToMessageId: job.replyToMessageId,
      sendToLark: true,
    });
    await finishRaw(raw);
    console.info(`[LarkAgentWorker] Done ${job.id} in ${Date.now() - startedAt}ms`);
  } catch (error) {
    await finishRaw(raw);
    const nextJob = { ...job, attempts: job.attempts + 1 };
    const message = error instanceof Error ? error.message : String(error);
    if (nextJob.attempts < maxAttempts && !stopping) {
      await redis.lpush(LARK_AGENT_QUEUE_KEY, JSON.stringify(nextJob));
      console.error(`[LarkAgentWorker] Retry ${job.id}: ${message}`);
    } else {
      await redis.lpush(
        LARK_AGENT_FAILED_KEY,
        JSON.stringify({ ...nextJob, failedAt: Date.now(), error: message }),
      );
      console.error(`[LarkAgentWorker] Failed ${job.id}: ${message}`);
      // Tell the asker instead of leaving them waiting with no reply.
      await sendLarkTextNotification(
        "⚠️ AI Agent đang gặp lỗi khi xử lý câu hỏi này, vui lòng thử lại sau ít phút.",
        {
          receiveId: job.receiveId,
          receiveIdType: job.receiveIdType,
          replyToMessageId: job.replyToMessageId,
        },
      ).catch((notifyError) => {
        console.error(`[LarkAgentWorker] Không gửi được thông báo lỗi ${job.id}:`, notifyError);
      });
    }
  } finally {
    activeSessions.delete(job.sessionId);
    activeCount -= 1;
  }
}

function dispatchPending() {
  while (activeCount < concurrency) {
    const index = pending.findIndex(({ job }) => !activeSessions.has(job.sessionId));
    if (index < 0) break;
    const [{ raw, job }] = pending.splice(index, 1);
    activeSessions.add(job.sessionId);
    activeCount += 1;
    void processJob(raw, job);
  }
}

async function main() {
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });

  await redis.ping();
  await recoverInterruptedJobs();
  console.info(`[LarkAgentWorker] Started ${workerId}, concurrency=${concurrency}`);

  while (!stopping) {
    dispatchPending();

    if (pending.length >= concurrency * 10) {
      await sleep(100);
      continue;
    }

    const raw = await redis.brpoplpush(
      LARK_AGENT_QUEUE_KEY,
      LARK_AGENT_PROCESSING_KEY,
      1,
    );
    if (!raw) continue;

    try {
      pending.push({ raw, job: parseLarkAgentJob(raw) });
    } catch (error) {
      await finishRaw(raw);
      await redis.lpush(
        LARK_AGENT_FAILED_KEY,
        JSON.stringify({ raw, failedAt: Date.now(), error: String(error) }),
      );
    }
  }

  while (activeCount > 0) await sleep(250);
  await redis.quit();
  console.info("[LarkAgentWorker] Stopped");
}

main().catch((error) => {
  console.error("[LarkAgentWorker] Fatal:", error);
  process.exitCode = 1;
});
