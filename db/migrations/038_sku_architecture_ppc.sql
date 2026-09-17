-- 038_sku_architecture_ppc.sql
-- SKU-First Architecture Migration for PPC Analytics

-- 1. Quản lý Phôi (Product Cost Master)
CREATE TABLE IF NOT EXISTS product_cost_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type TEXT NOT NULL,
  base_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  default_amazon_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0300,
  version INTEGER NOT NULL DEFAULT 1,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_cost_master_version_unique UNIQUE(product_type, version)
);

-- 2. SKU Economics
CREATE TABLE IF NOT EXISTS sku_economics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  asin TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT 'Ornament',
  selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  base_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  amazon_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0300,
  profit_before_ads NUMERIC(10, 2) NOT NULL DEFAULT 0,
  break_even_acos NUMERIC(5, 2) NOT NULL DEFAULT 0,
  cr NUMERIC(5, 4) NOT NULL DEFAULT 0,
  cr_source TEXT NOT NULL DEFAULT 'ACTUAL_30D',
  max_bid NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cost_source TEXT NOT NULL DEFAULT 'INHERITED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sku_economics_store_sku_unique UNIQUE(store_id, sku)
);

-- 3. PPC Rule Versions
CREATE TABLE IF NOT EXISTS ppc_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_rule_versions_type_version_unique UNIQUE(campaign_type, version)
);

-- 4. PPC Actions (Action Queue)
CREATE TABLE IF NOT EXISTS ppc_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  recommendation_id TEXT,
  sku TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  campaign_type TEXT NOT NULL DEFAULT 'SP',
  ad_group_id TEXT NOT NULL DEFAULT '',
  ad_group_name TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  target_keyword TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT 'Exact',
  entity_type TEXT NOT NULL DEFAULT 'KEYWORD',
  action_type TEXT NOT NULL,
  old_value NUMERIC(10, 2),
  system_suggested_value NUMERIC(10, 2),
  final_value NUMERIC(10, 2),
  rule_version TEXT NOT NULL DEFAULT 'v1.0',
  matched_rule_id TEXT,
  status TEXT NOT NULL DEFAULT 'APPROVED',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bulk Exports
CREATE TABLE IF NOT EXISTS bulk_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES ppc_stores(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  action_count INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Bulk Export Items
CREATE TABLE IF NOT EXISTS bulk_export_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_export_id UUID NOT NULL REFERENCES bulk_exports(id) ON DELETE CASCADE,
  action_id UUID REFERENCES ppc_actions(id) ON DELETE SET NULL,
  amazon_entity_type TEXT NOT NULL,
  amazon_operation TEXT NOT NULL,
  export_status TEXT NOT NULL DEFAULT 'EXPORTED',
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for optimal performance
CREATE INDEX IF NOT EXISTS product_cost_master_lookup_idx ON product_cost_master(product_type, version DESC);
CREATE INDEX IF NOT EXISTS sku_economics_store_idx ON sku_economics(store_id, sku);
CREATE INDEX IF NOT EXISTS ppc_actions_queue_idx ON ppc_actions(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ppc_actions_target_conflict_idx ON ppc_actions(store_id, campaign_id, target_id, status);
CREATE INDEX IF NOT EXISTS bulk_exports_store_idx ON bulk_exports(store_id, created_at DESC);

-- Seed Initial Product Cost Master
INSERT INTO product_cost_master (product_type, base_cost, default_amazon_fee, tax_rate, version, notes)
VALUES
  ('Ornament', 2.00, 6.32, 0.0300, 1, 'Standard Glass/Ceramic Ornament Phôi'),
  ('Bullet Tumbler', 5.00, 8.50, 0.0300, 1, 'Stainless Steel 20oz Bullet Tumbler'),
  ('Blanket', 7.00, 11.50, 0.0300, 1, 'Custom Fleece/Sherpa Blanket')
ON CONFLICT (product_type, version) DO NOTHING;

-- Seed Initial Rule Versions
INSERT INTO ppc_rule_versions (campaign_type, version, status, rule_json)
VALUES
  ('SB01', 'v1.0', 'PUBLISHED', '{
    "campaignType": "SB01",
    "hasOrder": [
      {"minAcos": 0, "maxAcos": 15, "action": "BID_INCREASE", "pct": 8, "base": "CURRENT_BID", "description": "+8% Current Bid"},
      {"minAcos": 15, "maxAcos": 25, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid"},
      {"minAcos": 25, "maxAcos": 40, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold (Optimal)"},
      {"minAcos": 40, "maxAcos": 48, "action": "BID_DECREASE", "pct": -8, "base": "AVG_CPC", "description": "-8% Avg CPC"},
      {"minAcos": 48, "maxAcos": 9999, "action": "BID_DECREASE", "pct": -15, "base": "AVG_CPC", "description": "-15% Avg CPC"}
    ],
    "noOrder": [
      {"minClicks": 0, "maxClicks": 0, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid to trigger traffic"},
      {"minClicks": 1, "maxClicks": 9, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold"},
      {"minClicks": 10, "maxClicks": 13, "action": "BID_DECREASE", "pct": -10, "base": "AVG_CPC", "description": "-10% Avg CPC"},
      {"minClicks": 14, "maxClicks": 9999, "action": "PAUSE_TARGET", "pct": 0, "base": "MIN_BID", "description": "Pause Target"}
    ],
    "limits": {"minBid": 0.10, "maxBid": 1.51}
  }'::jsonb),
  ('SB05', 'v1.0', 'PUBLISHED', '{
    "campaignType": "SB05",
    "hasOrder": [
      {"minAcos": 0, "maxAcos": 15, "action": "BID_INCREASE", "pct": 8, "base": "CURRENT_BID", "description": "+8% Current Bid"},
      {"minAcos": 15, "maxAcos": 25, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid"},
      {"minAcos": 25, "maxAcos": 40, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold (Optimal)"},
      {"minAcos": 40, "maxAcos": 48, "action": "BID_DECREASE", "pct": -8, "base": "AVG_CPC", "description": "-8% Avg CPC"},
      {"minAcos": 48, "maxAcos": 9999, "action": "BID_DECREASE", "pct": -15, "base": "AVG_CPC", "description": "-15% Avg CPC"}
    ],
    "noOrder": [
      {"minClicks": 0, "maxClicks": 0, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid to trigger traffic"},
      {"minClicks": 1, "maxClicks": 8, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold"},
      {"minClicks": 9, "maxClicks": 11, "action": "BID_DECREASE", "pct": -10, "base": "AVG_CPC", "description": "-10% Avg CPC"},
      {"minClicks": 12, "maxClicks": 9999, "action": "PAUSE_TARGET", "pct": 0, "base": "MIN_BID", "description": "Pause Target"}
    ],
    "limits": {"minBid": 0.25, "maxBid": 1.51}
  }'::jsonb),
  ('SP03', 'v1.0', 'PUBLISHED', '{
    "campaignType": "SP03",
    "hasOrder": [
      {"minAcos": 0, "maxAcos": 25, "action": "BID_INCREASE", "pct": 8, "base": "CURRENT_BID", "description": "+8% Current Bid"},
      {"minAcos": 25, "maxAcos": 35, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid"},
      {"minAcos": 35, "maxAcos": 48, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold (Optimal)"},
      {"minAcos": 48, "maxAcos": 55, "action": "BID_DECREASE", "pct": -8, "base": "AVG_CPC", "description": "-8% Avg CPC"},
      {"minAcos": 55, "maxAcos": 9999, "action": "BID_DECREASE", "pct": -15, "base": "AVG_CPC", "description": "-15% Avg CPC"}
    ],
    "noOrder": [
      {"minClicks": 0, "maxClicks": 0, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid to trigger traffic"},
      {"minClicks": 1, "maxClicks": 7, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold"},
      {"minClicks": 8, "maxClicks": 10, "action": "BID_DECREASE", "pct": -10, "base": "AVG_CPC", "description": "-10% Avg CPC"},
      {"minClicks": 11, "maxClicks": 9999, "action": "PAUSE_TARGET", "pct": 0, "base": "MIN_BID", "description": "Pause Target"}
    ],
    "limits": {"minBid": 0.60, "maxBid": 1.81}
  }'::jsonb)
ON CONFLICT (campaign_type, version) DO NOTHING;
