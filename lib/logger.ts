type LogLevel = "info" | "warn" | "error";

function serializeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: process.env.NODE_ENV === "production" ? undefined : error.stack }
    : { message: String(error) };
}

export function logEvent(
  level: LogLevel,
  event: string,
  metadata: Record<string, unknown> = {},
  error?: unknown,
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...metadata,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
