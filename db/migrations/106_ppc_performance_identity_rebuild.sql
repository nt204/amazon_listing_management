-- Rebuilds the identity constraint dropped by 105. CREATE UNIQUE INDEX holds a SHARE lock:
-- reads continue, PPC writes wait (instead of failing or slipping in duplicates) until done.
SET LOCAL maintenance_work_mem = '512MB';

DROP INDEX IF EXISTS ppc_performance_identity_unique_rebuild;

CREATE UNIQUE INDEX ppc_performance_identity_unique_rebuild
  ON ppc_performance_facts (
    store_id, snapshot_date, report_start_date, report_end_date, ad_type, grain, identity_key
  );

ALTER TABLE ppc_performance_facts
  ADD CONSTRAINT ppc_performance_identity_unique
  UNIQUE USING INDEX ppc_performance_identity_unique_rebuild;
