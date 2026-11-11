export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startMockupJobWorker } = await import("@/lib/mockup-job-worker");
    startMockupJobWorker();
    const { startInventorySheetSyncScheduler } = await import("@/lib/accounting/inventory-sheet-scheduler");
    startInventorySheetSyncScheduler();
    const { startBaseCostResyncWorker } = await import("@/lib/accounting/base-cost-resync");
    startBaseCostResyncWorker();
    const { startManualBidPrewarm } = await import("@/lib/ppc/manual-bid-attribution");
    const { getDatabaseClient } = await import("@/lib/db");
    startManualBidPrewarm(getDatabaseClient);
  }
}
