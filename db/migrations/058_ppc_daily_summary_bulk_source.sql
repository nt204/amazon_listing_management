-- Keep dashboard time-series metrics on the same source of truth as overview
-- KPIs: one-day CAMPAIGN rows from Amazon Bulk files.
-- Multi-day snapshots are intentionally excluded because their totals cannot be
-- converted into exact daily values.

TRUNCATE TABLE ppc_daily_summary;

INSERT INTO ppc_daily_summary (
  store_id, report_date, ad_type,
  impressions, clicks, spend, sales, orders, units,
  cpc, ctr, cvr, acos, roas, updated_at
)
SELECT
  p.store_id,
  p.report_end_date,
  COALESCE(p.ad_type, 'UNKNOWN'),
  COALESCE(SUM(p.impressions), 0),
  COALESCE(SUM(p.clicks), 0),
  COALESCE(SUM(p.spend), 0),
  COALESCE(SUM(p.sales), 0),
  COALESCE(SUM(p.orders), 0),
  COALESCE(SUM(p.units), 0),
  CASE WHEN SUM(p.clicks) > 0 THEN ROUND((SUM(p.spend) / SUM(p.clicks))::numeric, 2) ELSE 0 END,
  CASE WHEN SUM(p.impressions) > 0 THEN ROUND((SUM(p.clicks)::numeric / SUM(p.impressions)::numeric) * 100, 4) ELSE 0 END,
  CASE WHEN SUM(p.clicks) > 0 THEN ROUND((SUM(p.orders)::numeric / SUM(p.clicks)::numeric) * 100, 4) ELSE 0 END,
  CASE WHEN SUM(p.sales) > 0 THEN ROUND((SUM(p.spend) / SUM(p.sales) * 100)::numeric, 2)
       WHEN SUM(p.spend) > 0 THEN 999 ELSE 0 END,
  CASE WHEN SUM(p.spend) > 0 THEN ROUND((SUM(p.sales) / SUM(p.spend))::numeric, 2) ELSE 0 END,
  NOW()
FROM ppc_performance_facts p
WHERE p.grain = 'CAMPAIGN'
  AND p.report_start_date = p.report_end_date
GROUP BY p.store_id, p.report_end_date, COALESCE(p.ad_type, 'UNKNOWN');

-- Normalize counters used by overview cards. "Active" means Amazon state is
-- explicitly enabled; traffic in the selected period is not a status.
UPDATE ppc_snapshot_summary sm
SET
  active_campaign_count = counts.active_campaign_count,
  target_count = counts.target_count,
  active_target_count = counts.active_target_count,
  updated_at = NOW()
FROM (
  SELECT
    sm0.id,
    COUNT(*) FILTER (
      WHERE p.grain = 'CAMPAIGN'
        AND lower(COALESCE(NULLIF(p.campaign_state, ''), NULLIF(p.state, ''), '')) = 'enabled'
    ) AS active_campaign_count,
    COUNT(*) FILTER (WHERE p.grain = 'TARGET' AND NOT p.is_negative) AS target_count,
    COUNT(*) FILTER (
      WHERE p.grain = 'TARGET' AND NOT p.is_negative
        AND lower(COALESCE(p.state, '')) = 'enabled'
    ) AS active_target_count
  FROM ppc_snapshot_summary sm0
  LEFT JOIN ppc_performance_facts p
    ON p.store_id = sm0.store_id
   AND p.report_start_date = sm0.report_start_date
   AND p.report_end_date = sm0.report_end_date
   AND p.ad_type = sm0.ad_type
  GROUP BY sm0.id
) counts
WHERE sm.id = counts.id;

UPDATE ppc_campaign_summary cs
SET
  target_count = counts.target_count,
  active_target_count = counts.active_target_count,
  updated_at = NOW()
FROM (
  SELECT
    cs0.id,
    COUNT(*) FILTER (WHERE NOT p.is_negative) AS target_count,
    COUNT(*) FILTER (
      WHERE NOT p.is_negative AND lower(COALESCE(p.state, '')) = 'enabled'
    ) AS active_target_count
  FROM ppc_campaign_summary cs0
  LEFT JOIN ppc_active_snapshots a
    ON a.store_id = cs0.store_id
   AND a.snapshot_id = cs0.snapshot_id
   AND a.coverage_days = cs0.coverage_days
  LEFT JOIN ppc_performance_facts p
    ON p.store_id = cs0.store_id
   AND p.campaign_id = cs0.campaign_id
   AND p.ad_type = cs0.ad_type
   AND p.grain = 'TARGET'
   AND p.report_start_date = a.report_start_date
   AND p.report_end_date = a.report_end_date
  GROUP BY cs0.id
) counts
WHERE cs.id = counts.id;
