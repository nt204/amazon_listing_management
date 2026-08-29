export const ACTIVE_MOCKUP_JOB_POLL_MS = 3_000;
export const IDLE_MOCKUP_JOB_POLL_MS = 15_000;

export function mockupJobPollingDelay(
  activeJobCount: number,
  visibilityState: DocumentVisibilityState,
) {
  if (visibilityState !== "visible") return null;
  return activeJobCount > 0
    ? ACTIVE_MOCKUP_JOB_POLL_MS
    : IDLE_MOCKUP_JOB_POLL_MS;
}
