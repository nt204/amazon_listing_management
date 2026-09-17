-- Speed up the target visibility check used by PPC Analytics. The dashboard only
-- needs campaign rows that can make an enabled target visible, so keep the index
-- small and aligned with that exact lookup.
CREATE INDEX IF NOT EXISTS ppc_performance_active_campaign_lookup_idx
  ON ppc_performance_facts (
    store_id,
    ad_type,
    snapshot_date,
    report_end_date,
    campaign_id
  )
  WHERE grain = 'CAMPAIGN'
    AND (state = 'enabled' OR spend > 0 OR impressions > 0);
