/**
 * Browser notifications never include message plaintext — only a conversation title.
 */
export function messageAlertDecision(input: {
  conversationId: string;
  activeConversationId: string | null;
  pageVisible: boolean;
}): boolean {
  if (input.pageVisible && input.activeConversationId === input.conversationId) {
    return false;
  }
  return true;
}

/** Group MLS application blobs reuse the same visibility rule. */
export function groupAlertDecision(input: {
  kind: string | undefined;
  conversationId: string;
  activeConversationId: string | null;
  pageVisible: boolean;
}): boolean {
  if (input.kind !== "application") return false;
  return messageAlertDecision(input);
}
