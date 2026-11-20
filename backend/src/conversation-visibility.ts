export function canListConversation(input: {
  initiatedByUserId: string | null;
  hasMessages: boolean;
  userId: string;
  type?: "DIRECT" | "GROUP";
}) {
  if (input.type === "GROUP") return true;
  return input.hasMessages || input.initiatedByUserId === input.userId;
}
