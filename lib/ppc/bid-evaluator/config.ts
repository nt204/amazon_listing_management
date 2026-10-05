import type { EvaluatorConfig } from "./types";

export const DEFAULT_CONFIG: Readonly<EvaluatorConfig> = Object.freeze({
  t_min: 3.0,
  t_spend_ratio: 0.1,
  t_expected_ratio: 0.1,
  quality_multiplier_low: 1.25,
  min_clicks: {
    7: 15,
    14: 30,
    30: 60,
  },
  min_orders_alt: 5,
  min_baseline_clicks: 30,
  min_baseline_days: 25,
  min_data_coverage: 0.9,
  min_effective_bid_delta: 3.0,
  attribution_buffer_days: 5,
  n_control_min: 5,
  n_control_high: 10,
  sales_preserved_ratio: 0.9,
  orders_preserved_ratio: 0.9,
  learning_windows: [30],
  cooldown_days: 14,
  label_version: 1,
  evaluator_version: 1,
});

/**
 * Returns a cloned instance of the default configuration.
 */
export function getDefaultConfig(): EvaluatorConfig {
  return {
    ...DEFAULT_CONFIG,
    min_clicks: { ...DEFAULT_CONFIG.min_clicks },
    learning_windows: [...DEFAULT_CONFIG.learning_windows],
  };
}

/**
 * Creates an evaluator config with optional overrides.
 */
export function createConfig(overrides?: Partial<EvaluatorConfig>): EvaluatorConfig {
  const base = getDefaultConfig();
  if (!overrides) return base;

  return {
    ...base,
    ...overrides,
    min_clicks: {
      ...base.min_clicks,
      ...(overrides.min_clicks || {}),
    },
    learning_windows: overrides.learning_windows
      ? [...overrides.learning_windows]
      : base.learning_windows,
  };
}
