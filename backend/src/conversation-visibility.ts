export function canListConversation(input: {
  initiatedByUserId: string | null;
  hasMessages: boolean;
  userId: string;
}) {
  return input.hasMessages || input.initiatedByUserId === input.userId;
}
