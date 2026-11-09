-- These indexes had 0 scans in production from 2026-10-02 to 2026-11-03 (~660 MB on a nearly
-- full disk). Already dropped by hand on production on 2026-11-03; this keeps other
-- environments in line. IF EXISTS makes it a no-op where they are gone.
DROP INDEX IF EXISTS idx_ppc_camp_summary_name_trgm;
DROP INDEX IF EXISTS idx_ppc_camp_summary_spend;
DROP INDEX IF EXISTS idx_ppc_camp_summary_orders;
DROP INDEX IF EXISTS ppc_performance_active_campaign_lookup_idx;
