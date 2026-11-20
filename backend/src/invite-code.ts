import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Unambiguous alphabet. 32 symbols, so each byte contributes 5 bits. */
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const inviteCodeLength = 12;

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function inviteCodeFromBytes(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += alphabet[byte & 31];
  return out;
}

export function generateInviteCode(): string {
  return inviteCodeFromBytes(randomBytes(inviteCodeLength));
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

export function inviteCodeHint(code: string): string {
  return normalizeInviteCode(code).slice(-4);
}

export function inviteHashesMatch(storedHex: string, code: string): boolean {
  const next = hashInviteCode(code);
  if (!/^[0-9a-f]{64}$/.test(storedHex)) return false;
  const left = Buffer.from(storedHex, "hex");
  const right = Buffer.from(next, "hex");
  return timingSafeEqual(left, right);
}

export function invitePath(code: string): string {
  return `/join?code=${encodeURIComponent(normalizeInviteCode(code))}`;
}

export const defaultInviteHours = 24 * 7;
export const maxInviteHours = 24 * 14;
export const minInviteHours = 1;

export function inviteExpiry(now: Date, hours: number): Date | null {
  if (!Number.isInteger(hours) || hours < minInviteHours || hours > maxInviteHours) return null;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
