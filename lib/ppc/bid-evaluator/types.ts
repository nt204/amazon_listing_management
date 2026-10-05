export type UserAction =
  | "APPLY_AI"
  | "APPLY_RULE"
  | "EDIT"
  | "REJECT"
  | "IGNORE";

export type EvaluationWindow = 7 | 14 | 30 | number;

export type ExternalEventType =
  | "PRICE_CHANGE"
  | "LISTING_CHANGE"
  | "COUPON_OR_DEAL"
  | "BUDGET_CHANGE"
  | "PLACEMENT_CHANGE"
  | "STOCKOUT"
  | "SPECIAL_EVENT"
  | "TRACKING_ISSUE";

export type ConfoundFlag =
  | ExternalEventType
  | "OVERLAPPING_ACTION"
  | "INTERRUPTED_BY_NEW_ACTION"
  | "SUPERSEDED_BY_NEW_ACTION";

export type EvaluationStatus = "PENDING" | "PROVISIONAL" | "EVALUATED" | "NOT_APPLICABLE";

export type ValidityStatus =
  | "VALID"
  | "INCONCLUSIVE"
  | "CONFOUNDED"
  | "INTERRUPTED"
  | "SUPERSEDED";

export type EvaluationLabel =
  | "POSITIVE"
  | "NEUTRAL"
  | "NEGATIVE"
  | "INCONCLUSIVE"
  | "CONFOUNDED"
  | "INTERRUPTED"
  | "SUPERSEDED";

export type ExpectedSource = "control_group" | "own_30d_avg";

export type BaselineQuality = "HIGH" | "LOW";

export type ProfitReasonCode =
  | "CONTRIBUTION_ABOVE_EXPECTED"
  | "CONTRIBUTION_BELOW_EXPECTED"
  | "WITHIN_NOISE";

export type AcosReasonCode =
  | "ACOS_IMPROVED"
  | "ACOS_WORSENED"
  | "ACOS_ABOVE_BE";

export type VolumeReasonCode =
  | "SALES_PRESERVED"
  | "SALES_DROPPED"
  | "ORDERS_PRESERVED"
  | "ORDERS_DROPPED";

export type InconclusiveReasonCode =
  | "LOW_CLICKS"
  | "LOW_ORDERS"
  | "THIN_BASELINE"
  | "MISSING_DATA"
  | "BID_CHANGE_TOO_SMALL";

export type ReasonCode =
  | ProfitReasonCode
  | AcosReasonCode
  | VolumeReasonCode
  | InconclusiveReasonCode
  | ConfoundFlag;

export interface DailyMetric {
  date: string; // YYYY-MM-DD
  impressions?: number;
  clicks: number;
  orders: number;
  ad_sales: number;
  ad_spend: number;
}

export interface BidDecision {
  decision_id: string;
  target_id: string;
  applied_at: string; // ISO date string or YYYY-MM-DD
  current_bid: number;
  applied_bid: number;
  pre_ads_contribution_margin_pct: number; // e.g. 0.35 or 35 (normalized to 0.35)
  is_control: boolean;
  user_action: UserAction;
}

export interface ExternalEvent {
  date: string; // YYYY-MM-DD
  type: ExternalEventType;
  description?: string;
}

export interface OtherBidAction {
  action_id?: string;
  target_id: string;
  applied_at: string; // ISO date string or YYYY-MM-DD
  applied_bid: number;
}

export interface MatchedControlSample {
  control_id?: string;
  target_id?: string;
  actual_contribution_w: number;
  expected_own_w: number;
  shift_w?: number; // actual_contribution_w - expected_own_w
}

export interface EvaluatorConfig {
  t_min: number; // default $3
  t_spend_ratio: number; // default 0.10 (10%)
  t_expected_ratio?: number; // default 0.10 (10% of |Expected Contribution|)
  quality_multiplier_low: number; // default 1.25
  min_clicks: Record<number, number>; // { 7: 15, 14: 30, 30: 60 }
  min_orders_alt: number; // default 5
  min_baseline_clicks: number; // default 30
  min_baseline_days: number; // default 25
  min_data_coverage: number; // default 0.90 (90%)
  min_effective_bid_delta: number; // default 3.0 (3%)
  attribution_buffer_days: number; // default 5
  n_control_min: number; // default 5
  n_control_high: number; // default 10
  sales_preserved_ratio: number; // default 0.90 (90%)
  orders_preserved_ratio: number; // default 0.90 (90%)
  learning_windows: number[]; // default [30]
  cooldown_days: number; // default 14
  label_version: number;
  evaluator_version: number;
}

export interface EvaluationInput {
  decision: BidDecision;
  daily_metrics?: DailyMetric[];
  baseline_metrics_summary?: AggregatedMetrics;
  after_metrics_summary?: AggregatedMetrics;
  external_events?: ExternalEvent[];
  other_bid_actions?: OtherBidAction[];
  matched_controls?: MatchedControlSample[];
  window: EvaluationWindow;
  evaluation_date: string; // Current run date (YYYY-MM-DD)
  evaluation_version?: number;
  config?: EvaluatorConfig;
}

export interface AggregatedMetrics {
  clicks: number;
  orders: number;
  ad_sales: number;
  ad_spend: number;
  acos: number | null;
  contribution: number;
  days_with_data?: number;
  total_days?: number;
}

export interface ExpectedBaseline {
  value: number;
  source: ExpectedSource;
  control_count: number;
  control_shift_w: number;
  expected_own_w: number;
}

export interface EvaluationResult {
  decision_id: string;
  window: number;
  evaluation_version: number;
  label_version: number;
  evaluator_version: number;
  status: EvaluationStatus;
  label: EvaluationLabel | null;
  validity: ValidityStatus | null;
  confound_flags: ConfoundFlag[];
  reason_codes: ReasonCode[];
  expected_baseline: ExpectedBaseline | null;
  baseline_quality: BaselineQuality | null;
  actual_contribution: number | null;
  reward_usd: number | null;
  reward_norm: number | null;
  T: number | null;
  baseline_metrics: AggregatedMetrics | null;
  after_metrics: AggregatedMetrics | null;
  applied_delta_pct: number;
  eligible_for_learning: boolean;
  end_clean_observation?: string | null;
  interrupted_by_action_id?: string | null;
  superseded_by_action_id?: string | null;
  evaluated_at: string;
}
