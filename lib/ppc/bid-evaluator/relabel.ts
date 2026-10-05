import { evaluateBidDecision } from "./evaluator";
import type { EvaluationInput, EvaluationResult, EvaluatorConfig } from "./types";

export interface BatchRelabelOptions {
  newConfig: EvaluatorConfig;
  targetEvaluationVersion?: number;
}

/**
 * Re-labels historical bid decisions using updated configuration and label version.
 * Pure function: Does not mutate the original inputs or old results.
 */
export function batchRelabelBidDecisions(
  inputs: EvaluationInput[],
  options: BatchRelabelOptions
): EvaluationResult[] {
  return inputs.map((input) => {
    const nextEvaluationVersion =
      options.targetEvaluationVersion ??
      (input.evaluation_version !== undefined ? input.evaluation_version + 1 : 1);

    return evaluateBidDecision({
      ...input,
      config: options.newConfig,
      evaluation_version: nextEvaluationVersion,
    });
  });
}
