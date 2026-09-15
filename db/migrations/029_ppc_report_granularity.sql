ALTER TABLE ppc_search_terms
  ADD COLUMN IF NOT EXISTS report_granularity TEXT NOT NULL DEFAULT 'DAILY';

ALTER TABLE ppc_search_terms
  DROP CONSTRAINT IF EXISTS ppc_search_terms_report_granularity_check;

ALTER TABLE ppc_search_terms
  ADD CONSTRAINT ppc_search_terms_report_granularity_check
  CHECK (report_granularity IN ('DAILY', 'RANGE'));

CREATE INDEX IF NOT EXISTS idx_ppc_search_terms_granularity_coverage
  ON ppc_search_terms(store_id, report_granularity, report_start_date, report_end_date);
