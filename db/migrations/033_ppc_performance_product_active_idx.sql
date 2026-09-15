-- Update partial index to include PRODUCT grain for complete SKU visibility and optimization
DROP INDEX IF EXISTS ppc_performance_active_idx;

CREATE INDEX IF NOT EXISTS ppc_performance_active_idx 
ON ppc_performance_facts (store_id, grain, spend)
WHERE spend > 0 OR clicks > 0 OR impressions > 0 OR grain IN ('CAMPAIGN', 'AD_GROUP', 'PRODUCT');
