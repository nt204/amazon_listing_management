ALTER TABLE ppc_performance_facts
  ADD COLUMN IF NOT EXISTS is_negative BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ppc_performance_negative_idx
  ON ppc_performance_facts(store_id, ad_type, grain, is_negative);
