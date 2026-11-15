export type LogicalMessageLike = {
  id: string;
  logicalMessageId?: string | null;
  createdAt: string;
};

export function dedupeLogicalMessages<T extends LogicalMessageLike>(
  messages: T[],
) {
  const ordered = [...messages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const unique = new Map<string, T>();
  for (const message of ordered) {
    const key = message.logicalMessageId || message.id;
    if (!unique.has(key)) unique.set(key, message);
  }
  return [...unique.values()];
}
