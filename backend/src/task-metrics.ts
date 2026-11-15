export type TaskRouteMetric =
  | "tasks_created_count"
  | "tasks_updated_count"
  | "tasks_listed_count"
  | "tasks_authz_denied_count";

const counters: Record<TaskRouteMetric, number> = {
  tasks_created_count: 0,
  tasks_updated_count: 0,
  tasks_listed_count: 0,
  tasks_authz_denied_count: 0,
};

export function bumpTaskMetric(metric: TaskRouteMetric, by = 1) {
  const amount = Number.isFinite(by) ? Math.max(0, Math.floor(by)) : 0;
  counters[metric] = Math.min(1_000_000_000, counters[metric] + amount);
  return counters[metric];
}

export function snapshotTaskMetrics() {
  return { ...counters };
}
