-- 043_update_bid_limits_ratio.sql
-- Cập nhật giới hạn trần:
-- SP03 lấy theo trần kinh tế phôi (sku_max_bid),
-- SB05 bằng 80% SP03, SB01 bằng 80% SP03.

-- 1. Cập nhật config_json của amazon_ppc_common_bid_rules trong ppc_sku_mapping_rules
UPDATE ppc_sku_mapping_rules
SET config_json = jsonb_set(
      jsonb_set(
        jsonb_set(
          config_json,
          '{campaign_rules,SB01,bid_limits}',
          '{"min_bid": 0.1, "max_bid": 10.0, "max_bid_factor": 0.8, "max_bid_ref": "80_pct_sp03_max_bid"}'::jsonb
        ),
        '{campaign_rules,SB05,bid_limits}',
        '{"min_bid": 0.25, "max_bid": 10.0, "max_bid_factor": 0.8, "max_bid_ref": "80_pct_sp03_max_bid"}'::jsonb
      ),
      '{campaign_rules,SP03,bid_limits}',
      '{"min_bid": 0.5, "max_bid": 10.0, "max_bid_factor": 1.0, "max_bid_ref": "sku_max_bid"}'::jsonb
    ),
    version = '1.1.0',
    updated_at = NOW()
WHERE rule_set_id = 'amazon_ppc_common_bid_rules';

-- 2. Cập nhật ppc_rule_versions cho từng chiến dịch
UPDATE ppc_rule_versions
SET rule_json = jsonb_set(
      rule_json,
      '{limits}',
      '{"minBid": 0.10, "maxBid": 10.0, "maxBidFactor": 0.8, "maxBidRef": "80_pct_sp03_max_bid"}'::jsonb
    )
WHERE campaign_type = 'SB01';

UPDATE ppc_rule_versions
SET rule_json = jsonb_set(
      rule_json,
      '{limits}',
      '{"minBid": 0.25, "maxBid": 10.0, "maxBidFactor": 0.8, "maxBidRef": "80_pct_sp03_max_bid"}'::jsonb
    )
WHERE campaign_type = 'SB05';

UPDATE ppc_rule_versions
SET rule_json = jsonb_set(
      rule_json,
      '{limits}',
      '{"minBid": 0.50, "maxBid": 10.0, "maxBidFactor": 1.0, "maxBidRef": "sku_max_bid"}'::jsonb
    )
WHERE campaign_type = 'SP03';

UPDATE ppc_rule_versions
SET rule_json = jsonb_set(
      rule_json,
      '{limits}',
      '{"minBid": 0.50, "maxBid": 10.0, "maxBidFactor": 1.0, "maxBidRef": "sku_max_bid"}'::jsonb
    )
WHERE campaign_type IN ('SP01', 'SP04');
