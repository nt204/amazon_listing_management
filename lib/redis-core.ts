export interface RedisKeyScanner {
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    countValue: number,
  ): Promise<[string, string[]]>;
  unlink(...keys: string[]): Promise<number>;
}

export async function scanAndUnlinkKeys(
  redis: RedisKeyScanner,
  pattern: string,
  batchSize = 200,
) {
  let cursor = "0";
  let deleted = 0;
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      Math.max(10, batchSize),
    );
    cursor = nextCursor;
    if (keys.length > 0) deleted += await redis.unlink(...keys);
  } while (cursor !== "0");
  return deleted;
}
