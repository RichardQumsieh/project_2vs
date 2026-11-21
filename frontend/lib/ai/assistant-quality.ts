import record from "./assistant-quality-record.json";

/**
 * The product label follows a recorded real-model score, not the mock harness.
 * `npm run eval:assistant -- --mode=real` writes assistant-quality-record.json
 * only when the average is at least 0.8. Until that file says passed, Sophia
 * stays labeled experimental.
 */
export const ASSISTANT_QUALITY_THRESHOLD = 0.8;

export const recordedAssistantScore =
  typeof record.average === "number" ? record.average : null;

export const ASSISTANT_EXPERIMENTAL =
  record.passed !== true ||
  recordedAssistantScore === null ||
  recordedAssistantScore < ASSISTANT_QUALITY_THRESHOLD;

export const ASSISTANT_QUALITY_REASON = ASSISTANT_EXPERIMENTAL
  ? "No real-model English or Levantine Arabic run has recorded an average of at least 0.8. Sophia stays labeled experimental."
  : "A real-model eval recorded an average of at least 0.8.";
