export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startMockupJobWorker } = await import("@/lib/mockup-job-worker");
    startMockupJobWorker();
  }
}
