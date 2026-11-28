const typingWindowMs = 2_000;
const lastTyping = new Map<string, number>();

export function parseTypingSignal(value: unknown): { conversationId: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { type?: unknown; conversationId?: unknown };
  if (record.type !== "typing" || typeof record.conversationId !== "string") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.conversationId)) {
    return null;
  }
  return { conversationId: record.conversationId };
}

/** At most one typing signal per member per conversation in the window. */
export function allowTypingSignal(userId: string, conversationId: string, now = Date.now()) {
  const key = `${userId}:${conversationId}`;
  const previous = lastTyping.get(key);
  if (previous !== undefined && now - previous < typingWindowMs) return false;
  lastTyping.set(key, now);
  if (lastTyping.size > 5_000) {
    for (const [id, at] of lastTyping) {
      if (now - at >= typingWindowMs) lastTyping.delete(id);
    }
  }
  return true;
}

/** Ephemeral presence. The payload is a user id, never message text, and nothing is stored. */
export async function relayGroupTyping(userId: string, value: unknown) {
  const parsed = parseTypingSignal(value);
  if (!parsed || !allowTypingSignal(userId, parsed.conversationId)) return;
  const { prisma } = await import("./db.js");
  const { redis } = await import("./redis.js");
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: parsed.conversationId,
      type: "GROUP",
      members: { some: { userId } },
    },
    select: { members: { select: { userId: true } } },
  });
  if (!conversation) return;
  const payload = JSON.stringify({
    type: "group_typing",
    conversationId: parsed.conversationId,
    userId,
  });
  await Promise.all(
    conversation.members
      .filter((member) => member.userId !== userId)
      .map((member) => redis.publish(`user:${member.userId}`, payload)),
  );
}
