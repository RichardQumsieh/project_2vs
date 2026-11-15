export type DeletableMessage = {
  id: string;
  logicalMessageId: string | null;
  senderUserId: string;
};

export function canDeleteMessages(
  messages: DeletableMessage[],
  userId: string,
) {
  return messages.length > 0 &&
    messages.every((message) => message.senderUserId === userId);
}

export function messageDeletionRecordIds(
  logicalMessageId: string,
  messages: Pick<DeletableMessage, "id">[],
) {
  return [...new Set([logicalMessageId, ...messages.map((message) => message.id)])];
}
