/**
 * A group notification names the conversation only. It does not include
 * message plaintext. The server event carries the blob kind, not the body.
 */
export function groupAlertDecision(input: {
  kind: string | undefined;
  conversationId: string;
  activeConversationId: string | null;
  pageVisible: boolean;
}): boolean {
  if (input.kind !== "application") return false;
  if (input.pageVisible && input.activeConversationId === input.conversationId) return false;
  return true;
}
