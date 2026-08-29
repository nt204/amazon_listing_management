export interface AsyncTtlCacheState<T> {
  value?: T;
  expiresAt?: number;
  pending?: Promise<T>;
}

export async function cachedSingleFlight<T>(
  state: AsyncTtlCacheState<T>,
  ttlMs: number,
  loader: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  if (state.value !== undefined && (state.expiresAt || 0) > now()) {
    return state.value;
  }
  if (state.pending) return state.pending;

  const pending = loader()
    .then((value) => {
      state.value = value;
      state.expiresAt = now() + Math.max(0, ttlMs);
      return value;
    })
    .finally(() => {
      if (state.pending === pending) state.pending = undefined;
    });
  state.pending = pending;
  return pending;
}

export async function keyedSingleFlight<T>(
  pendingByKey: Map<string, Promise<unknown>>,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const existing = pendingByKey.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = loader().finally(() => {
    if (pendingByKey.get(key) === pending) pendingByKey.delete(key);
  });
  pendingByKey.set(key, pending);
  return pending;
}
