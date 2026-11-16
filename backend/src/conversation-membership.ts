import { prisma } from "./db.js";

export async function userIsConversationMember(
  conversationId: string,
  userId: string,
) {
  if (!conversationId || !userId) {
    return false;
  }
  const member = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
    select: { userId: true },
  });
  return Boolean(member);
}
