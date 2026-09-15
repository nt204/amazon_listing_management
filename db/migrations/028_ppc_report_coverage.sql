ALTER TABLE ppc_search_terms
  ADD COLUMN IF NOT EXISTS report_start_date DATE,
  ADD COLUMN IF NOT EXISTS report_end_date DATE,
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_group_id TEXT,
  ADD COLUMN IF NOT EXISTS keyword_id TEXT;

UPDATE ppc_search_terms
SET
  report_start_date = COALESCE(report_start_date, report_date),
  report_end_date = COALESCE(report_end_date, report_date)
WHERE report_start_date IS NULL OR report_end_date IS NULL;

ALTER TABLE ppc_search_terms
  ALTER COLUMN report_start_date SET NOT NULL,
  ALTER COLUMN report_end_date SET NOT NULL;

ALTER TABLE ppc_search_terms
  DROP CONSTRAINT IF EXISTS ppc_search_terms_report_coverage_check;

ALTER TABLE ppc_search_terms
  ADD CONSTRAINT ppc_search_terms_report_coverage_check
  CHECK (report_start_date <= report_end_date AND report_date = report_end_date);

CREATE INDEX IF NOT EXISTS ppc_search_terms_store_coverage_idx
  ON ppc_search_terms(store_id, report_start_date, report_end_date);
