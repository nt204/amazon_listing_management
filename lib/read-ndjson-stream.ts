export async function readNdjsonStream<T>(
  response: Response,
  onEvent: (event: T) => void,
) {
  if (!response.body) throw new Error("Server không trả về luồng tiến độ.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  const consume = (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as T);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
    if (pending.trim()) onEvent(JSON.parse(pending) as T);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
