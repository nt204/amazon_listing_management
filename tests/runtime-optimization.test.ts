import test from "node:test";
import assert from "node:assert/strict";
import {
  cachedSingleFlight,
  keyedSingleFlight,
  type AsyncTtlCacheState,
} from "../lib/async-cache";
import { mockupJobPollingDelay } from "../lib/polling";
import { scanAndUnlinkKeys, type RedisKeyScanner } from "../lib/redis-core";

test("TTL cache shares concurrent work and reuses the completed value", async () => {
  let clock = 100;
  let calls = 0;
  const state: AsyncTtlCacheState<{ call: number }> = {};
  const load = async () => {
    calls += 1;
    await Promise.resolve();
    return { call: calls };
  };

  const [first, second] = await Promise.all([
    cachedSingleFlight(state, 1_000, load, () => clock),
    cachedSingleFlight(state, 1_000, load, () => clock),
  ]);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);

  clock = 500;
  assert.strictEqual(
    await cachedSingleFlight(state, 1_000, load, () => clock),
    first,
  );

  clock = 1_101;
  const refreshed = await cachedSingleFlight(state, 1_000, load, () => clock);
  assert.equal(calls, 2);
  assert.notStrictEqual(refreshed, first);
});

test("single-flight state is released after a failed request", async () => {
  const pending = new Map<string, Promise<unknown>>();
  await assert.rejects(
    keyedSingleFlight(pending, "trello", async () => {
      throw new Error("temporary failure");
    }),
    /temporary failure/,
  );
  assert.equal(pending.size, 0);
  assert.equal(
    await keyedSingleFlight(pending, "trello", async () => "recovered"),
    "recovered",
  );
});

test("Redis invalidation scans incrementally and unlinks matching batches", async () => {
  const scanned: string[] = [];
  const unlinked: string[][] = [];
  const pages = new Map<string, [string, string[]]>([
    ["0", ["12", ["trello:1", "trello:2"]]],
    ["12", ["0", ["trello:3"]]],
  ]);
  const redis: RedisKeyScanner = {
    async scan(cursor, _match, pattern, _count, count) {
      scanned.push(`${cursor}:${pattern}:${count}`);
      return pages.get(cursor) || ["0", []];
    },
    async unlink(...keys) {
      unlinked.push(keys);
      return keys.length;
    },
  };

  assert.equal(await scanAndUnlinkKeys(redis, "trello:*", 100), 3);
  assert.deepEqual(scanned, ["0:trello:*:100", "12:trello:*:100"]);
  assert.deepEqual(unlinked, [["trello:1", "trello:2"], ["trello:3"]]);
});

test("mockup polling stays responsive for active jobs and rests when idle", () => {
  assert.equal(mockupJobPollingDelay(2, "visible"), 3_000);
  assert.equal(mockupJobPollingDelay(0, "visible"), 15_000);
  assert.equal(mockupJobPollingDelay(2, "hidden"), null);
});
