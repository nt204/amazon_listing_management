export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}
