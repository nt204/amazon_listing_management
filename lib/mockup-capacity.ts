import "server-only";

import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { getReadyRedisClient } from "@/lib/redis";

export interface MockupLease {
  release(): Promise<void>;
}

interface LocalCapacityState {
  active: number;
  activeImagesByPool: Map<string, number>;
  imageQueuesByPool: Map<string, string[]>;
  cardLocks: Set<string>;
}

export type MockupImagePool =
  | "cheapkeyai"
  | "openai"
  | "gemini"
  | "chatgpt-web"
  | "trello-upload"
  | "default";

const globalForMockupCapacity = globalThis as unknown as {
  mockupCapacity?: LocalCapacityState;
  warnedAboutLocalMockupCapacity?: boolean;
};

const localState =
  globalForMockupCapacity.mockupCapacity ||
  (globalForMockupCapacity.mockupCapacity = {
    active: 0,
    activeImagesByPool: new Map(),
    imageQueuesByPool: new Map(),
    cardLocks: new Set<string>(),
  });

// Fast Refresh can retain the state object created by an older module version.
localState.activeImagesByPool ||= new Map();
localState.imageQueuesByPool ||= new Map();

const CAPACITY_KEY = "listing-desk:mockup:active-products";
const IMAGE_CAPACITY_KEY = "listing-desk:mockup:active-images";
const IMAGE_QUEUE_KEY = "listing-desk:mockup:image-queue";
const IMAGE_QUEUE_SEQUENCE_KEY = "listing-desk:mockup:image-queue-sequence";
const CARD_LOCK_PREFIX = "listing-desk:mockup:card:";
const LEASE_TTL_MS = 90_000;
const RENEW_INTERVAL_MS = 30_000;
const QUEUE_POLL_MS = 750;

const ACQUIRE_CAPACITY_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZCARD", KEYS[1]) < tonumber(ARGV[2]) then
  redis.call("ZADD", KEYS[1], ARGV[3], ARGV[4])
  redis.call("PEXPIRE", KEYS[1], ARGV[5])
  return 1
end
return 0
`;

const RENEW_CAPACITY_SCRIPT = `
if redis.call("ZSCORE", KEYS[1], ARGV[1]) then
  redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
  redis.call("PEXPIRE", KEYS[1], ARGV[3])
  return 1
end
return 0
`;

const RELEASE_CAPACITY_SCRIPT = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;

const ACQUIRE_IMAGE_SLOT_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if not redis.call("ZSCORE", KEYS[2], ARGV[2]) then
  local sequence = redis.call("INCR", KEYS[3])
  redis.call("ZADD", KEYS[2], sequence, ARGV[2])
end
redis.call("PEXPIRE", KEYS[2], ARGV[5])
redis.call("PEXPIRE", KEYS[3], ARGV[5])
local active = redis.call("ZCARD", KEYS[1])
local available = tonumber(ARGV[3]) - active
local rank = redis.call("ZRANK", KEYS[2], ARGV[2])
if available > 0 and rank and rank < available then
  redis.call("ZREM", KEYS[2], ARGV[2])
  redis.call("ZADD", KEYS[1], ARGV[4], ARGV[2])
  redis.call("PEXPIRE", KEYS[1], ARGV[5])
  return 1
end
return 0
`;

const RENEW_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function configuredActiveProductLimit() {
  const parsed = Number(process.env.MOCKUP_MAX_ACTIVE_PRODUCTS || 5);
  return Number.isFinite(parsed)
    ? Math.min(10, Math.max(1, Math.round(parsed)))
    : 5;
}

function configuredGlobalImageLimit(pool: MockupImagePool) {
  const configured =
    pool === "cheapkeyai"
      ? process.env.MOCKUP_MAX_CHEAPKEYAI_IMAGE_REQUESTS
      : pool === "trello-upload"
        ? process.env.MOCKUP_MAX_TRELLO_UPLOADS
        : process.env.MOCKUP_MAX_GLOBAL_IMAGE_REQUESTS;
  const fallback = pool === "cheapkeyai" ? 3 : pool === "trello-upload" ? 2 : 6;
  const parsed = Number(configured || fallback);
  return Number.isFinite(parsed)
    ? Math.min(12, Math.max(1, Math.round(parsed)))
    : fallback;
}

function imagePoolKey(base: string, pool: MockupImagePool) {
  return `${base}:${pool}`;
}

function configuredQueueTimeoutMs() {
  const parsed = Number(process.env.MOCKUP_QUEUE_TIMEOUT_MS || 300_000);
  return Number.isFinite(parsed)
    ? Math.min(600_000, Math.max(30_000, Math.round(parsed)))
    : 300_000;
}

function abortError() {
  return new DOMException("Tác vụ tạo mockup đã bị hủy.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || abortError();
}

function wait(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason || abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout.unref?.();
  });
}

function warnAboutLocalFallback() {
  if (globalForMockupCapacity.warnedAboutLocalMockupCapacity) return;
  globalForMockupCapacity.warnedAboutLocalMockupCapacity = true;
  console.warn(
    "[Mockup capacity] Redis chưa sẵn sàng; đang dùng giới hạn trong một tiến trình. Production nhiều instance phải cấu hình Redis.",
  );
}

function renewableRedisLease(
  redis: Redis,
  renew: () => Promise<unknown>,
  release: () => Promise<unknown>,
): MockupLease {
  let released = false;
  const renewal = setInterval(() => {
    void renew().catch((error) => {
      console.warn("[Mockup capacity] Không thể gia hạn Redis lease:", error);
    });
  }, RENEW_INTERVAL_MS);
  renewal.unref?.();

  return {
    async release() {
      if (released) return;
      released = true;
      clearInterval(renewal);
      await release().catch((error) => {
        console.warn("[Mockup capacity] Không thể giải phóng Redis lease:", error);
      });
    },
  };
}

async function acquireRedisCapacity(
  redis: Redis,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<MockupLease> {
  const token = randomUUID();
  const limit = configuredActiveProductLimit();
  const deadline = Date.now() + configuredQueueTimeoutMs();
  let waitReported = false;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const now = Date.now();
    const acquired = Number(
      await redis.eval(
        ACQUIRE_CAPACITY_SCRIPT,
        1,
        CAPACITY_KEY,
        now,
        limit,
        now + LEASE_TTL_MS,
        token,
        LEASE_TTL_MS * 2,
      ),
    );
    if (acquired === 1) {
      return renewableRedisLease(
        redis,
        () =>
          redis.eval(
            RENEW_CAPACITY_SCRIPT,
            1,
            CAPACITY_KEY,
            token,
            Date.now() + LEASE_TTL_MS,
            LEASE_TTL_MS * 2,
          ),
        () => redis.eval(RELEASE_CAPACITY_SCRIPT, 1, CAPACITY_KEY, token),
      );
    }

    if (!waitReported) {
      waitReported = true;
      onWait?.();
    }
    await wait(QUEUE_POLL_MS + Math.round(Math.random() * 250), signal);
  }

  throw new Error(
    "Hàng đợi tạo mockup đang đầy. Hãy chờ các sản phẩm đang chạy hoàn tất rồi thử lại.",
  );
}

async function acquireLocalCapacity(
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<MockupLease> {
  warnAboutLocalFallback();
  const limit = configuredActiveProductLimit();
  const deadline = Date.now() + configuredQueueTimeoutMs();
  let waitReported = false;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (localState.active < limit) {
      localState.active += 1;
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          localState.active = Math.max(0, localState.active - 1);
        },
      };
    }
    if (!waitReported) {
      waitReported = true;
      onWait?.();
    }
    await wait(QUEUE_POLL_MS, signal);
  }

  throw new Error(
    "Hàng đợi tạo mockup đang đầy. Hãy chờ các sản phẩm đang chạy hoàn tất rồi thử lại.",
  );
}

export async function acquireMockupCapacity(
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<MockupLease> {
  const redis = await getReadyRedisClient();
  return redis
    ? acquireRedisCapacity(redis, signal, onWait)
    : acquireLocalCapacity(signal, onWait);
}

async function acquireRedisImageSlot(
  redis: Redis,
  pool: MockupImagePool,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<MockupLease> {
  const token = randomUUID();
  const limit = configuredGlobalImageLimit(pool);
  const capacityKey = imagePoolKey(IMAGE_CAPACITY_KEY, pool);
  const queueKey = imagePoolKey(IMAGE_QUEUE_KEY, pool);
  const sequenceKey = imagePoolKey(IMAGE_QUEUE_SEQUENCE_KEY, pool);
  const deadline = Date.now() + configuredQueueTimeoutMs();
  let acquired = false;
  let waitReported = false;

  try {
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const now = Date.now();
      acquired =
        Number(
          await redis.eval(
            ACQUIRE_IMAGE_SLOT_SCRIPT,
            3,
            capacityKey,
            queueKey,
            sequenceKey,
            now,
            token,
            limit,
            now + LEASE_TTL_MS,
            LEASE_TTL_MS * 2,
          ),
        ) === 1;
      if (acquired) {
        return renewableRedisLease(
          redis,
          () =>
            redis.eval(
              RENEW_CAPACITY_SCRIPT,
              1,
              capacityKey,
              token,
              Date.now() + LEASE_TTL_MS,
              LEASE_TTL_MS * 2,
            ),
          () => redis.eval(RELEASE_CAPACITY_SCRIPT, 1, capacityKey, token),
        );
      }

      if (!waitReported) {
        waitReported = true;
        onWait?.();
      }
      await wait(250 + Math.round(Math.random() * 100), signal);
    }
  } finally {
    if (!acquired) {
      await redis.zrem(queueKey, token).catch(() => undefined);
    }
  }

  throw new Error(
    pool === "trello-upload"
      ? "Hàng đợi upload Trello đang đầy. Hãy chờ các ảnh đang tải lên hoàn tất rồi thử lại."
      : "Hàng đợi request ảnh AI đang đầy. Hãy chờ các ảnh đang chạy hoàn tất rồi thử lại.",
  );
}

async function acquireLocalImageSlot(
  pool: MockupImagePool,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<MockupLease> {
  warnAboutLocalFallback();
  const token = randomUUID();
  const limit = configuredGlobalImageLimit(pool);
  const deadline = Date.now() + configuredQueueTimeoutMs();
  let acquired = false;
  let waitReported = false;
  const queue = localState.imageQueuesByPool.get(pool) || [];
  queue.push(token);
  localState.imageQueuesByPool.set(pool, queue);

  try {
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const activeImages = localState.activeImagesByPool.get(pool) || 0;
      const rank = queue.indexOf(token);
      if (rank >= 0 && rank < limit - activeImages) {
        queue.splice(rank, 1);
        localState.activeImagesByPool.set(pool, activeImages + 1);
        acquired = true;
        let released = false;
        return {
          async release() {
            if (released) return;
            released = true;
            localState.activeImagesByPool.set(
              pool,
              Math.max(
                0,
                (localState.activeImagesByPool.get(pool) || 0) - 1,
              ),
            );
          },
        };
      }
      if (!waitReported) {
        waitReported = true;
        onWait?.();
      }
      await wait(250, signal);
    }
  } finally {
    if (!acquired) {
      const queuedIndex = queue.indexOf(token);
      if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    }
  }

  throw new Error(
    pool === "trello-upload"
      ? "Hàng đợi upload Trello đang đầy. Hãy chờ các ảnh đang tải lên hoàn tất rồi thử lại."
      : "Hàng đợi request ảnh AI đang đầy. Hãy chờ các ảnh đang chạy hoàn tất rồi thử lại.",
  );
}

export async function acquireMockupImageSlot(
  signal?: AbortSignal,
  pool: MockupImagePool = "default",
  onWait?: () => void,
): Promise<MockupLease> {
  const redis = await getReadyRedisClient();
  return redis
    ? acquireRedisImageSlot(redis, pool, signal, onWait)
    : acquireLocalImageSlot(pool, signal, onWait);
}

export async function tryAcquireMockupCardLock(
  cardId: string,
): Promise<MockupLease | null> {
  const redis = await getReadyRedisClient();
  const key = `${CARD_LOCK_PREFIX}${cardId}`;
  const token = randomUUID();

  if (redis) {
    const acquired = await redis.set(key, token, "PX", LEASE_TTL_MS, "NX");
    if (acquired !== "OK") return null;
    return renewableRedisLease(
      redis,
      () => redis.eval(RENEW_LOCK_SCRIPT, 1, key, token, LEASE_TTL_MS),
      () => redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token),
    );
  }

  warnAboutLocalFallback();
  if (localState.cardLocks.has(key)) return null;
  localState.cardLocks.add(key);
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      localState.cardLocks.delete(key);
    },
  };
}
