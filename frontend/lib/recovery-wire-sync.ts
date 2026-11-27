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
