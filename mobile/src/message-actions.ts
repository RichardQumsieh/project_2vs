export type DeleteScope = "me" | "everyone";

export function deleteScopes(message: { fromMe: boolean; pending: boolean }): DeleteScope[] {
  if (message.pending || !message.fromMe) return ["me"];
  return ["me", "everyone"];
}

/** Physical swipe: right deletes, left replies. */
export function swipeIntent(translationX: number, threshold = 72): "delete" | "reply" | null {
  if (translationX >= threshold) return "delete";
  if (translationX <= -threshold) return "reply";
  return null;
}

/**
 * ReanimatedSwipeable reports the direction the row moved.
 * "right" (translationX > 0) opens the leading delete action.
 * "left" opens the trailing reply action.
 */
export function swipeOpenAction(direction: "left" | "right"): "delete" | "reply" {
  return direction === "right" ? "delete" : "reply";
}
