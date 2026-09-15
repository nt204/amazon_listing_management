-- Partial index to accelerate dashboard queries by indexing only active and structural grains
CREATE INDEX IF NOT EXISTS ppc_performance_active_idx 
ON ppc_performance_facts (store_id, grain, spend)
WHERE spend > 0 OR clicks > 0 OR impressions > 0 OR grain IN ('CAMPAIGN', 'AD_GROUP');
