import type { PpcRuleDefinition } from "./sku-architecture-types";

type CampaignType = "SB01" | "SB05" | "SP03";
type ActionName = "INCREASE_BID" | "HOLD_BID" | "DECREASE_BID" | "PAUSE";
type ActionBase = "CURRENT_BID" | "AVG_CPC" | "NONE";

interface RawAction {
  action: ActionName;
  adjustment_pct: number | null;
  base: ActionBase;
  formula: string | null;
}

interface RawZone {
  rule_id: string;
  min?: number;
  max?: number;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
  min_ref?: "break_even_acos_pct";
  max_ref?: "break_even_acos_pct" | "min_40_break_even_acos_pct";
  active_when?: "break_even_acos_pct > 40";
  action_ref: string;
}

interface RawCampaignRule {
  display_name: string;
  has_order: { metric: "acos_pct"; zones: RawZone[] };
  no_order: { metric: "clicks"; zones: RawZone[] };
  bid_limits: {
    min_bid: number;
    max_bid: number;
    max_bid_factor?: number;
    max_bid_ref?: string;
  };
  budget_rule: unknown;
}

export interface AmazonPpcCommonRuleSet {
  schema_version: string;
  rule_set_id: "amazon_ppc_common_bid_rules";
  rule_set_name: string;
  scope: { campaign_types: CampaignType[]; [key: string]: unknown };
  general_logic: Record<string, unknown>;
  actions: Record<string, RawAction>;
  campaign_rules: Record<CampaignType, RawCampaignRule>;
  parser_rules: Record<string, unknown>;
  calculation_flow: string[];
  output_schema: Record<string, string>;
}

const CAMPAIGN_TYPES: CampaignType[] = ["SB01", "SB05", "SP03"];
const ACTIONS = new Set<ActionName>(["INCREASE_BID", "HOLD_BID", "DECREASE_BID", "PAUSE"]);
const BASES = new Set<ActionBase>(["CURRENT_BID", "AVG_CPC", "NONE"]);

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} phải là object.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} phải là số hợp lệ.`);
  return value;
}

function validateZone(zoneValue: unknown, path: string, actions: Record<string, RawAction>) {
  const zone = object(zoneValue, path);
  if (typeof zone.rule_id !== "string" || !zone.rule_id) throw new Error(`${path}.rule_id không hợp lệ.`);
  if (typeof zone.action_ref !== "string" || !actions[zone.action_ref]) throw new Error(`${path}.action_ref không tồn tại.`);
  if (zone.min !== undefined) finite(zone.min, `${path}.min`);
  if (zone.max !== undefined) finite(zone.max, `${path}.max`);
  if (zone.min_ref !== undefined && zone.min_ref !== "break_even_acos_pct") throw new Error(`${path}.min_ref không hỗ trợ.`);
  if (zone.max_ref !== undefined && !["break_even_acos_pct", "min_40_break_even_acos_pct"].includes(String(zone.max_ref))) throw new Error(`${path}.max_ref không hỗ trợ.`);
  if (zone.active_when !== undefined && zone.active_when !== "break_even_acos_pct > 40") throw new Error(`${path}.active_when không hỗ trợ.`);
}

export function parseAmazonPpcCommonRuleSet(input: unknown): AmazonPpcCommonRuleSet {
  const root = object(input, "root");
  if (root.rule_set_id !== "amazon_ppc_common_bid_rules") throw new Error("rule_set_id không đúng.");
  if (typeof root.schema_version !== "string") throw new Error("Thiếu schema_version.");
  const actionsRaw = object(root.actions, "actions");
  const actions: Record<string, RawAction> = {};
  for (const [key, value] of Object.entries(actionsRaw)) {
    const action = object(value, `actions.${key}`);
    if (!ACTIONS.has(action.action as ActionName)) throw new Error(`actions.${key}.action không hỗ trợ.`);
    if (!BASES.has(action.base as ActionBase)) throw new Error(`actions.${key}.base không hỗ trợ.`);
    if (action.adjustment_pct !== null) finite(action.adjustment_pct, `actions.${key}.adjustment_pct`);
    actions[key] = action as unknown as RawAction;
  }
  const campaignsRaw = object(root.campaign_rules, "campaign_rules");
  for (const type of CAMPAIGN_TYPES) {
    const campaign = object(campaignsRaw[type], `campaign_rules.${type}`);
    const hasOrder = object(campaign.has_order, `campaign_rules.${type}.has_order`);
    const noOrder = object(campaign.no_order, `campaign_rules.${type}.no_order`);
    if (!Array.isArray(hasOrder.zones) || !Array.isArray(noOrder.zones)) throw new Error(`${type} phải có đủ zones.`);
    hasOrder.zones.forEach((z, i) => validateZone(z, `${type}.has_order.zones[${i}]`, actions));
    noOrder.zones.forEach((z, i) => validateZone(z, `${type}.no_order.zones[${i}]`, actions));
    const limits = object(campaign.bid_limits, `campaign_rules.${type}.bid_limits`);
    const min = finite(limits.min_bid, `${type}.min_bid`);
    const max = finite(limits.max_bid, `${type}.max_bid`);
    if (min <= 0 || max < min) throw new Error(`${type}: trần/sàn bid không hợp lệ.`);
    if (limits.max_bid_factor !== undefined) finite(limits.max_bid_factor, `${type}.max_bid_factor`);
  }
  if (!root.parser_rules || !Array.isArray(root.calculation_flow) || !root.output_schema) throw new Error("Thiếu parser_rules, calculation_flow hoặc output_schema.");
  return input as AmazonPpcCommonRuleSet;
}

export function commonRuleToDefinitions(ruleSet: AmazonPpcCommonRuleSet): PpcRuleDefinition[] {
  return CAMPAIGN_TYPES.map((campaignType) => {
    const campaign = ruleSet.campaign_rules[campaignType];
    const mapAction = (zone: RawZone) => ruleSet.actions[zone.action_ref];
    return {
      campaignType,
      hasOrder: campaign.has_order.zones.map((zone) => {
        const action = mapAction(zone);
        return {
          minAcos: zone.min ?? 0,
          maxAcos: zone.max ?? 9999,
          action: action.action === "INCREASE_BID" ? "BID_INCREASE" : action.action === "DECREASE_BID" ? "BID_DECREASE" : "HOLD",
          pct: action.action === "DECREASE_BID" ? -(action.adjustment_pct ?? 0) : (action.adjustment_pct ?? 0),
          base: action.base,
          description: action.formula || action.action,
          ruleId: zone.rule_id,
          minInclusive: zone.min === undefined && zone.min_ref === undefined ? true : (zone.min_inclusive ?? false),
          maxInclusive: zone.max === undefined && zone.max_ref === undefined ? true : (zone.max_inclusive ?? false),
          minRef: zone.min_ref,
          maxRef: zone.max_ref,
          activeWhen: zone.active_when,
        };
      }),
      noOrder: campaign.no_order.zones.map((zone) => {
        const action = mapAction(zone);
        return {
          minClicks: zone.min ?? 0,
          maxClicks: zone.max ?? 9999,
          action: action.action === "INCREASE_BID" ? "BID_INCREASE" : action.action === "DECREASE_BID" ? "BID_DECREASE" : action.action === "PAUSE" ? "PAUSE_TARGET" : "HOLD",
          pct: action.action === "DECREASE_BID" ? -(action.adjustment_pct ?? 0) : (action.adjustment_pct ?? 0),
          base: action.action === "PAUSE" ? "NONE" : action.base,
          description: action.formula || action.action,
          ruleId: zone.rule_id,
          minInclusive: zone.min === undefined ? true : (zone.min_inclusive ?? false),
          maxInclusive: zone.max === undefined ? true : (zone.max_inclusive ?? false),
        };
      }),
      limits: {
        minBid: campaign.bid_limits.min_bid,
        maxBid: campaign.bid_limits.max_bid,
        maxBidFactor: campaign.bid_limits.max_bid_factor ?? (campaignType === "SP03" ? 1.0 : 0.8),
        maxBidRef: campaign.bid_limits.max_bid_ref ?? (campaignType === "SP03" ? "sku_max_bid" : "80_pct_sp03_max_bid"),
      },
    };
  });
}
