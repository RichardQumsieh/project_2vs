/**
 * Cross-device recovery history sync.
 *
 * DIRECT chats pull pairwise Double Ratchet envelopes from
 * GET /conversations/:id/messages. GROUP chats reject that path with 409
 * ("MLS blobs, not pairwise envelopes"); their live ciphertext is MLS, and
 * portable plaintext for other devices goes through the account archive.
 */
export function shouldFetchPairwiseWireHistory(
  conversationType: "DIRECT" | "GROUP",
): boolean {
  return conversationType === "DIRECT";
}

/** A GROUP thread rejected a pairwise envelope fetch. Skip it; do not fail history sync. */
export function isGroupEnvelopeRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? error.status : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return status === 409 && /MLS blobs, not pairwise envelopes/i.test(message);
}
