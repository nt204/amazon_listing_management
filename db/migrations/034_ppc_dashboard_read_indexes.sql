-- Optimize the hot read path used by PPC Analytics without changing stored data.
CREATE INDEX IF NOT EXISTS ppc_performance_latest_scope_idx
  ON ppc_performance_facts (
    store_id,
    ad_type,
    snapshot_date DESC,
    report_end_date DESC,
    report_start_date DESC
  );

CREATE INDEX IF NOT EXISTS ppc_performance_sku_campaign_idx
  ON ppc_performance_facts (store_id, lower(sku), ad_type, campaign_id);

CREATE INDEX IF NOT EXISTS ppc_search_terms_dashboard_scope_idx
  ON ppc_search_terms (
    store_id,
    report_granularity,
    report_date DESC,
    report_end_date DESC
  );
