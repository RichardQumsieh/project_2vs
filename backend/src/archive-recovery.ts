import { timingSafeEqual } from "node:crypto";

/**
 * Compare the stored archive recovery-code hash with the hash the signed-in
 * client presents when replacing the password wrap. The hash does not decrypt
 * the archive. A length mismatch returns false and does not throw.
 */
export function archiveRecoveryHashMatches(storedHash: string, suppliedHash: string) {
  const saved = Buffer.from(storedHash, "base64");
  const supplied = Buffer.from(suppliedHash, "base64");
  if (saved.length === 0 || saved.length !== supplied.length) return false;
  return timingSafeEqual(saved, supplied);
}
