/**
 * Live assistant quality has not cleared the evaluation bar.
 * The companion fixtures and the mock eval harness do not measure model quality.
 * Keep the product label until a live run in `scripts/eval-assistant.ts` scores
 * at least the threshold recorded in the report.
 */
export const ASSISTANT_EXPERIMENTAL = true;

export const ASSISTANT_QUALITY_REASON =
  "No live English or Levantine Arabic quality run has passed. Sophia stays labeled experimental.";
