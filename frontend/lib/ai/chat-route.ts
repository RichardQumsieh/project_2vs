export type OutgoingSurface = "composer" | "assistant";

/**
 * Friend-chat composer text always stays a chat message.
 * Invite links that mention Sophia, and the word Sophia itself, do not open
 * the assistant. Only the explicit assistant surface handles Sophia commands.
 */
export function outgoingTextDestination(surface: OutgoingSurface): "chat" | "assistant" {
  if (surface === "assistant") return "assistant";
  return "chat";
}
