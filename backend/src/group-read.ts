import { prisma } from "./db.js";
import { countUnreadGroupApplications, type GroupUnreadBlob } from "./group-e2ee.js";

/**
 * Each member's group read cursor, with the blob time so clients can tell
 * which messages that member has opened. Absent cursors stay null.
 */
export async function readCursorsFor(
  conversationIds: readonly string[],
): Promise<Map<string, Map<string, { blobId: string; createdAt: string }>>> {
  const byConversation = new Map<string, Map<string, { blobId: string; createdAt: string }>>();
  if (conversationIds.length === 0) return byConversation;
  const members = await prisma.conversationMember.findMany({
    where: {
      conversationId: { in: [...conversationIds] },
      groupReadBlobId: { not: null },
    },
    select: { conversationId: true, userId: true, groupReadBlobId: true },
  });
  const blobIds = members.flatMap((member) => (member.groupReadBlobId ? [member.groupReadBlobId] : []));
  if (blobIds.length === 0) return byConversation;
  const blobs = await prisma.groupMlsBlob.findMany({
    where: { id: { in: blobIds } },
    select: { id: true, createdAt: true },
  });
  const createdAt = new Map(blobs.map((blob) => [blob.id, blob.createdAt.toISOString()]));
  for (const member of members) {
    if (!member.groupReadBlobId) continue;
    const at = createdAt.get(member.groupReadBlobId);
    if (!at) continue;
    const cursors = byConversation.get(member.conversationId) ?? new Map();
    cursors.set(member.userId, { blobId: member.groupReadBlobId, createdAt: at });
    byConversation.set(member.conversationId, cursors);
  }
  return byConversation;
}

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
