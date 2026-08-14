import "server-only";
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redisClient?: Redis | null;
  redisConnected?: boolean;
};

export function getRedisClient(): Redis | null {
  if (globalForRedis.redisClient !== undefined) {
    return globalForRedis.redisClient;
  }

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    client.on("error", (err) => {
      if (globalForRedis.redisConnected) {
        console.warn("[Redis] Warning: Redis connection lost, falling back to direct mode.", err.message);
        globalForRedis.redisConnected = false;
      }
    });

    client.on("connect", () => {
      globalForRedis.redisConnected = true;
      console.log("[Redis] Connected to Redis Cache & Lock Manager successfully.");
    });

    // Fire lazy connection asynchronously
    client.connect().catch((err) => {
      console.warn("[Redis] Warning: Could not connect to Redis at startup. Fallback mode active.", err.message);
      globalForRedis.redisConnected = false;
    });

    globalForRedis.redisClient = client;
    return client;
  } catch (err) {
    console.warn("[Redis] Failed to initialize Redis client:", err);
    globalForRedis.redisClient = null;
    return null;
  }
}

/**
 * Smart cache wrapper: Tries to fetch data from Redis cache.
 * If cache miss or Redis unavailable, executes fallback fn and stores result in Redis with TTL.
 */
export async function getCachedOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fallbackFn: () => Promise<T>,
): Promise<T> {
  const redis = getRedisClient();

  if (redis && globalForRedis.redisConnected) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch {
      // Ignore Redis read error and proceed to fallback
    }
  }

  const freshData = await fallbackFn();

  if (redis && globalForRedis.redisConnected && freshData !== undefined && freshData !== null) {
    try {
      await redis.set(key, JSON.stringify(freshData), "EX", ttlSeconds);
    } catch {
      // Ignore Redis write error
    }
  }

  return freshData;
}

/**
 * Invalidate cached keys by exact key or wildcards (e.g. "trello:board:*")
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !globalForRedis.redisConnected) return;

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Redis] Invalidated ${keys.length} cached keys matching pattern "${pattern}".`);
    }
  } catch (err) {
    console.warn(`[Redis] Error invalidating pattern "${pattern}":`, err);
  }
}
