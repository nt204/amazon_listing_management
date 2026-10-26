-- The identity unique index was ~5x bloated by delete-and-reinsert snapshot uploads
-- (9.8 GB in production for ~1.6 GB of keys). The disk has no room to build a copy next
-- to it, so this file drops it in its own transaction to free the space first;
-- 106 rebuilds it compactly under the same constraint name. No table rows are touched.
ALTER TABLE ppc_performance_facts
  DROP CONSTRAINT IF EXISTS ppc_performance_identity_unique;
