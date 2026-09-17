-- 040_bid_optimization_rules.sql
-- Cập nhật bảng chi phí phôi ban đầu chuẩn 6 loại & Bộ quy tắc Bid Optimization chuẩn

-- 1. Làm sạch và thiết lập bảng Product Cost Master đúng 6 loại phôi ban đầu theo yêu cầu
DELETE FROM product_cost_master;

INSERT INTO product_cost_master (product_type, base_cost, default_amazon_fee, tax_rate, default_price, break_even_acos, version, notes)
VALUES
  ('Tumbler 20Oz',   4.20,  8.40, 0.0300, 25.00, 50.00, 1, 'PPC-14 ghi Profit Before Ads = 12.40'),
  ('Bullet Tumbler', 5.00,  8.50, 0.0300, 25.00, 46.00, 1, 'PPC-14 ghi Profit Before Ads = 11.50'),
  ('Blanket',        7.00, 11.50, 0.0300, 32.00, 42.00, 1, 'PPC-14 ghi Profit Before Ads = 13.50'),
  ('Hoodie',        10.00, 15.50, 0.0300, 43.00, 41.00, 1, 'PPC-14 ghi Profit Before Ads = 17.50'),
  ('Oodie',         11.50, 15.70, 0.0300, 49.99, 46.00, 1, 'PPC-14 ghi Profit Before Ads = 22.79'),
  ('Ornament',       2.00,  6.32, 0.0300, 15.99, 48.00, 1, 'PPC-14 ghi Profit Before Ads = 7.67')
ON CONFLICT (product_type, version) DO UPDATE
SET base_cost = EXCLUDED.base_cost,
    default_amazon_fee = EXCLUDED.default_amazon_fee,
    tax_rate = EXCLUDED.tax_rate,
    default_price = EXCLUDED.default_price,
    break_even_acos = EXCLUDED.break_even_acos,
    notes = EXCLUDED.notes,
    updated_at = NOW();

-- 2. Lưu trữ toàn bộ quy tắc amazon_ppc_common_bid_rules vào ppc_sku_mapping_rules
INSERT INTO ppc_sku_mapping_rules (rule_set_id, config_json, version)
VALUES ('amazon_ppc_common_bid_rules', '{
  "schema_version": "1.0.0",
  "rule_set_id": "amazon_ppc_common_bid_rules",
  "rule_set_name": "Amazon PPC Common Bid Optimization Rules",
  "scope": {
    "level": "target_or_keyword",
    "campaign_types": [
      "SB01",
      "SB05",
      "SP03"
    ],
    "optimization_cycle_days": 3,
    "break_even_acos_source": "sku_input",
    "rule_mode": "common_global_rules"
  },
  "general_logic": {
    "order_branch": {
      "has_order": "orders > 0",
      "no_order": "orders == 0"
    },
    "increase_bid_base": "current_bid",
    "decrease_bid_base": "avg_cpc",
    "hold_bid_base": "current_bid",
    "final_bid_formula": "min(max(calculated_bid, min_bid), max_bid)",
    "pause_overrides_other_actions": true
  },
  "actions": {
    "STRONG_INCREASE": {
      "action": "INCREASE_BID",
      "adjustment_pct": 8,
      "base": "CURRENT_BID",
      "formula": "current_bid * 1.08"
    },
    "INCREASE": {
      "action": "INCREASE_BID",
      "adjustment_pct": 5,
      "base": "CURRENT_BID",
      "formula": "current_bid * 1.05"
    },
    "HOLD": {
      "action": "HOLD_BID",
      "adjustment_pct": 0,
      "base": "CURRENT_BID",
      "formula": "current_bid"
    },
    "DECREASE": {
      "action": "DECREASE_BID",
      "adjustment_pct": 8,
      "base": "AVG_CPC",
      "formula": "avg_cpc * 0.92"
    },
    "STRONG_DECREASE": {
      "action": "DECREASE_BID",
      "adjustment_pct": 15,
      "base": "AVG_CPC",
      "formula": "avg_cpc * 0.85"
    },
    "NO_ORDER_INCREASE": {
      "action": "INCREASE_BID",
      "adjustment_pct": 5,
      "base": "CURRENT_BID",
      "formula": "current_bid * 1.05"
    },
    "NO_ORDER_DECREASE": {
      "action": "DECREASE_BID",
      "adjustment_pct": 10,
      "base": "AVG_CPC",
      "formula": "avg_cpc * 0.90"
    },
    "PAUSE": {
      "action": "PAUSE",
      "adjustment_pct": null,
      "base": "NONE",
      "formula": null,
      "review_after_days": 30
    }
  },
  "campaign_rules": {
    "SB01": {
      "display_name": "Sponsored Brand Collection",
      "has_order": {
        "metric": "acos_pct",
        "zones": [
          {
            "rule_id": "SB01_HAS_ORDER_STRONG_INCREASE",
            "min": 0,
            "min_inclusive": false,
            "max": 15,
            "max_inclusive": false,
            "action_ref": "STRONG_INCREASE"
          },
          {
            "rule_id": "SB01_HAS_ORDER_INCREASE",
            "min": 15,
            "min_inclusive": true,
            "max": 25,
            "max_inclusive": false,
            "action_ref": "INCREASE"
          },
          {
            "rule_id": "SB01_HAS_ORDER_HOLD",
            "min": 25,
            "min_inclusive": true,
            "max": 40,
            "max_inclusive": true,
            "action_ref": "HOLD"
          },
          {
            "rule_id": "SB01_HAS_ORDER_DECREASE",
            "min": 40,
            "min_inclusive": false,
            "max_ref": "break_even_acos_pct",
            "max_inclusive": true,
            "action_ref": "DECREASE"
          },
          {
            "rule_id": "SB01_HAS_ORDER_STRONG_DECREASE",
            "min_ref": "break_even_acos_pct",
            "min_inclusive": false,
            "action_ref": "STRONG_DECREASE"
          }
        ]
      },
      "no_order": {
        "metric": "clicks",
        "zones": [
          {
            "rule_id": "SB01_NO_ORDER_LOW_TRAFFIC",
            "max": 1,
            "max_inclusive": false,
            "action_ref": "NO_ORDER_INCREASE"
          },
          {
            "rule_id": "SB01_NO_ORDER_COLLECT_DATA",
            "min": 1,
            "min_inclusive": true,
            "max": 9,
            "max_inclusive": true,
            "action_ref": "HOLD"
          },
          {
            "rule_id": "SB01_NO_ORDER_HIGH_CLICKS",
            "min": 9,
            "min_inclusive": false,
            "max": 13,
            "max_inclusive": true,
            "action_ref": "NO_ORDER_DECREASE"
          },
          {
            "rule_id": "SB01_NO_ORDER_PAUSE",
            "min": 13,
            "min_inclusive": false,
            "action_ref": "PAUSE"
          }
        ]
      },
      "bid_limits": {
        "min_bid": 0.1,
        "max_bid": 1.5
      },
      "budget_rule": {
        "condition": {
          "metric": "acos_pct",
          "operator": "<",
          "value_ref": "break_even_acos_pct"
        },
        "action": "INCREASE_BUDGET",
        "increase_pct_min": 30,
        "increase_pct_max": 100,
        "review_after_days": 3
      }
    },
    "SB05": {
      "display_name": "Sponsored Brand Video",
      "has_order": {
        "metric": "acos_pct",
        "zones": [
          {
            "rule_id": "SB05_HAS_ORDER_STRONG_INCREASE",
            "min": 0,
            "min_inclusive": false,
            "max": 15,
            "max_inclusive": false,
            "action_ref": "STRONG_INCREASE"
          },
          {
            "rule_id": "SB05_HAS_ORDER_INCREASE",
            "min": 15,
            "min_inclusive": true,
            "max": 25,
            "max_inclusive": false,
            "action_ref": "INCREASE"
          },
          {
            "rule_id": "SB05_HAS_ORDER_HOLD",
            "min": 25,
            "min_inclusive": true,
            "max": 40,
            "max_inclusive": true,
            "action_ref": "HOLD"
          },
          {
            "rule_id": "SB05_HAS_ORDER_DECREASE",
            "min": 40,
            "min_inclusive": false,
            "max_ref": "break_even_acos_pct",
            "max_inclusive": true,
            "action_ref": "DECREASE"
          },
          {
            "rule_id": "SB05_HAS_ORDER_STRONG_DECREASE",
            "min_ref": "break_even_acos_pct",
            "min_inclusive": false,
            "action_ref": "STRONG_DECREASE"
          }
        ]
      },
      "no_order": {
        "metric": "clicks",
        "zones": [
          {
            "rule_id": "SB05_NO_ORDER_LOW_TRAFFIC",
            "max": 1,
            "max_inclusive": false,
            "action_ref": "NO_ORDER_INCREASE"
          },
          {
            "rule_id": "SB05_NO_ORDER_COLLECT_DATA",
            "min": 1,
            "min_inclusive": true,
            "max": 8,
            "max_inclusive": true,
            "action_ref": "HOLD"
          },
          {
            "rule_id": "SB05_NO_ORDER_HIGH_CLICKS",
            "min": 8,
            "min_inclusive": false,
            "max": 11,
            "max_inclusive": true,
            "action_ref": "NO_ORDER_DECREASE"
          },
          {
            "rule_id": "SB05_NO_ORDER_PAUSE",
            "min": 11,
            "min_inclusive": false,
            "action_ref": "PAUSE"
          }
        ]
      },
      "bid_limits": {
        "min_bid": 0.25,
        "max_bid": 1.75
      },
      "budget_rule": {
        "condition": {
          "metric": "acos_pct",
          "operator": "<",
          "value_ref": "break_even_acos_pct"
        },
        "action": "INCREASE_BUDGET",
        "increase_pct_min": 30,
        "increase_pct_max": 100,
        "review_after_days": 3
      }
    },
    "SP03": {
      "display_name": "Sponsored Product",
      "has_order": {
        "metric": "acos_pct",
        "zones": [
          {
            "rule_id": "SP03_HAS_ORDER_STRONG_INCREASE",
            "min": 0,
            "min_inclusive": false,
            "max": 20,
            "max_inclusive": false,
            "action_ref": "STRONG_INCREASE"
          },
          {
            "rule_id": "SP03_HAS_ORDER_INCREASE",
            "min": 20,
            "min_inclusive": true,
            "max": 30,
            "max_inclusive": false,
            "action_ref": "INCREASE"
          },
          {
            "rule_id": "SP03_HAS_ORDER_HOLD",
            "min": 30,
            "min_inclusive": true,
            "max": 40,
            "max_inclusive": true,
            "action_ref": "HOLD"
          },
          {
            "rule_id": "SP03_HAS_ORDER_DECREASE",
            "min": 40,
            "min_inclusive": false,
            "max": 50,
            "max_inclusive": true,
            "action_ref": "DECREASE"
          },
          {
            "rule_id": "SP03_HAS_ORDER_STRONG_DECREASE",
            "min": 50,
            "min_inclusive": false,
            "action_ref": "STRONG_DECREASE"
          }
        ]
      },
      "no_order": {
        "metric": "clicks",
        "zones": [
          {
            "rule_id": "SP03_NO_ORDER_LOW_TRAFFIC",
            "max": 1,
            "max_inclusive": false,
            "action_ref": "NO_ORDER_INCREASE"
          },
          {
            "rule_id": "SP03_NO_ORDER_COLLECT_DATA",
            "min": 1,
            "min_inclusive": true,
            "max": 7,
            "max_inclusive": true,
            "action_ref": "HOLD"
          },
          {
            "rule_id": "SP03_NO_ORDER_HIGH_CLICKS",
            "min": 7,
            "min_inclusive": false,
            "max": 10,
            "max_inclusive": true,
            "action_ref": "NO_ORDER_DECREASE"
          },
          {
            "rule_id": "SP03_NO_ORDER_PAUSE",
            "min": 10,
            "min_inclusive": false,
            "action_ref": "PAUSE"
          }
        ]
      },
      "bid_limits": {
        "min_bid": 0.5,
        "max_bid": 1.85
      },
      "budget_rule": {
        "condition": {
          "metric": "acos_pct",
          "operator": "<",
          "value_ref": "break_even_acos_plus_15_pct"
        },
        "action": "INCREASE_BUDGET",
        "increase_pct_min": 30,
        "increase_pct_max": 100,
        "review_after_days": 3
      }
    }
  }
}'::jsonb, '1.0.0')
ON CONFLICT (rule_set_id) DO UPDATE
SET config_json = EXCLUDED.config_json,
    version = EXCLUDED.version,
    updated_at = NOW();

-- 3. Cập nhật ppc_rule_versions cho từng chiến dịch SB01, SB05, SP03
UPDATE ppc_rule_versions
SET rule_json = '{
  "campaignType": "SB01",
  "hasOrder": [
    {"minAcos": 0, "maxAcos": 15, "action": "BID_INCREASE", "pct": 8, "base": "CURRENT_BID", "description": "+8% Current Bid"},
    {"minAcos": 15, "maxAcos": 25, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid"},
    {"minAcos": 25, "maxAcos": 40, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold (25% - 40%)"},
    {"minAcos": 40, "maxAcos": 48, "action": "BID_DECREASE", "pct": -8, "base": "AVG_CPC", "description": "-8% Avg CPC (40% đến ACoS Hòa Vốn)"},
    {"minAcos": 48, "maxAcos": 9999, "action": "BID_DECREASE", "pct": -15, "base": "AVG_CPC", "description": "-15% Avg CPC (> ACoS Hòa Vốn)"}
  ],
  "noOrder": [
    {"minClicks": 0, "maxClicks": 0, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid kích traffic"},
    {"minClicks": 1, "maxClicks": 9, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold quan sát (1 - 9 clicks)"},
    {"minClicks": 10, "maxClicks": 13, "action": "BID_DECREASE", "pct": -10, "base": "AVG_CPC", "description": "-10% Avg CPC (10 - 13 clicks)"},
    {"minClicks": 14, "maxClicks": 9999, "action": "PAUSE_TARGET", "pct": 0, "base": "MIN_BID", "description": "Pause Target (> 13 clicks)"}
  ],
  "limits": {"minBid": 0.10, "maxBid": 1.50}
}'::jsonb
WHERE campaign_type = 'SB01';

UPDATE ppc_rule_versions
SET rule_json = '{
  "campaignType": "SB05",
  "hasOrder": [
    {"minAcos": 0, "maxAcos": 15, "action": "BID_INCREASE", "pct": 8, "base": "CURRENT_BID", "description": "+8% Current Bid"},
    {"minAcos": 15, "maxAcos": 25, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid"},
    {"minAcos": 25, "maxAcos": 40, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold (25% - 40%)"},
    {"minAcos": 40, "maxAcos": 48, "action": "BID_DECREASE", "pct": -8, "base": "AVG_CPC", "description": "-8% Avg CPC (40% đến ACoS Hòa Vốn)"},
    {"minAcos": 48, "maxAcos": 9999, "action": "BID_DECREASE", "pct": -15, "base": "AVG_CPC", "description": "-15% Avg CPC (> ACoS Hòa Vốn)"}
  ],
  "noOrder": [
    {"minClicks": 0, "maxClicks": 0, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid kích traffic"},
    {"minClicks": 1, "maxClicks": 8, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold quan sát (1 - 8 clicks)"},
    {"minClicks": 9, "maxClicks": 11, "action": "BID_DECREASE", "pct": -10, "base": "AVG_CPC", "description": "-10% Avg CPC (9 - 11 clicks)"},
    {"minClicks": 12, "maxClicks": 9999, "action": "PAUSE_TARGET", "pct": 0, "base": "MIN_BID", "description": "Pause Target (> 11 clicks)"}
  ],
  "limits": {"minBid": 0.25, "maxBid": 1.75}
}'::jsonb
WHERE campaign_type = 'SB05';

UPDATE ppc_rule_versions
SET rule_json = '{
  "campaignType": "SP03",
  "hasOrder": [
    {"minAcos": 0, "maxAcos": 20, "action": "BID_INCREASE", "pct": 8, "base": "CURRENT_BID", "description": "+8% Current Bid (0% - 20%)"},
    {"minAcos": 20, "maxAcos": 30, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid (20% - 30%)"},
    {"minAcos": 30, "maxAcos": 40, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold (30% - 40%)"},
    {"minAcos": 40, "maxAcos": 50, "action": "BID_DECREASE", "pct": -8, "base": "AVG_CPC", "description": "-8% Avg CPC (40% - 50%)"},
    {"minAcos": 50, "maxAcos": 9999, "action": "BID_DECREASE", "pct": -15, "base": "AVG_CPC", "description": "-15% Avg CPC (> 50%)"}
  ],
  "noOrder": [
    {"minClicks": 0, "maxClicks": 0, "action": "BID_INCREASE", "pct": 5, "base": "CURRENT_BID", "description": "+5% Current Bid kích traffic"},
    {"minClicks": 1, "maxClicks": 7, "action": "HOLD", "pct": 0, "base": "NONE", "description": "Hold quan sát (1 - 7 clicks)"},
    {"minClicks": 8, "maxClicks": 10, "action": "BID_DECREASE", "pct": -10, "base": "AVG_CPC", "description": "-10% Avg CPC (8 - 10 clicks)"},
    {"minClicks": 11, "maxClicks": 9999, "action": "PAUSE_TARGET", "pct": 0, "base": "MIN_BID", "description": "Pause Target (> 10 clicks)"}
  ],
  "limits": {"minBid": 0.50, "maxBid": 1.85}
}'::jsonb
WHERE campaign_type = 'SP03';
