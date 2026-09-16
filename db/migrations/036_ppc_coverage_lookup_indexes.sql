-- Match the dashboard's supported report-duration lookup without evaluating ABS
-- across the full historical tables.
CREATE INDEX IF NOT EXISTS ppc_performance_coverage_days_idx
  ON ppc_performance_facts (
    store_id,
    ad_type,
    ((report_end_date - report_start_date + 1)),
    snapshot_date DESC,
    report_end_date DESC
  );

CREATE INDEX IF NOT EXISTS ppc_search_terms_coverage_days_idx
  ON ppc_search_terms (
    store_id,
    ad_type,
    report_granularity,
    ((report_end_date - report_start_date + 1)),
    report_end_date DESC
  );
