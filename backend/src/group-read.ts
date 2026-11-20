import { prisma } from "./db.js";
import { countUnreadGroupApplications, type GroupUnreadBlob } from "./group-e2ee.js";

/**
 * Unread counts from application-blob metadata. Payloads are not loaded.
 */
export async function unreadCountsFor(
  viewerUserId: string,
  conversationIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (conversationIds.length === 0) return counts;
  const [blobs, members] = await Promise.all([
    prisma.groupMlsBlob.findMany({
      where: { conversationId: { in: [...conversationIds] }, kind: "application" },
      select: {
        id: true,
        conversationId: true,
        kind: true,
        createdAt: true,
        senderDevice: { select: { userId: true } },
      },
    }),
    prisma.conversationMember.findMany({
      where: { userId: viewerUserId, conversationId: { in: [...conversationIds] } },
      select: { conversationId: true, groupReadBlobId: true },
    }),
  ]);
  const cursorIds = members.flatMap((member) => (member.groupReadBlobId ? [member.groupReadBlobId] : []));
  const cursors = cursorIds.length === 0
    ? []
    : await prisma.groupMlsBlob.findMany({
        where: { id: { in: cursorIds } },
        select: { id: true, createdAt: true, conversationId: true },
      });
  const cursorByConversation = new Map(cursors.map((cursor) => [cursor.conversationId, cursor]));
  const rows: GroupUnreadBlob[] = blobs.map((blob) => ({
    id: blob.id,
    conversationId: blob.conversationId,
    kind: blob.kind,
    createdAt: blob.createdAt.toISOString(),
    senderUserId: blob.senderDevice.userId,
  }));
  for (const conversationId of conversationIds) {
    const cursor = cursorByConversation.get(conversationId);
    counts.set(
      conversationId,
      countUnreadGroupApplications({
        blobs: rows,
        conversationId,
        viewerUserId,
        readThrough: cursor
          ? { id: cursor.id, createdAt: cursor.createdAt.toISOString() }
          : null,
      }),
    );
  }
  return counts;
}
