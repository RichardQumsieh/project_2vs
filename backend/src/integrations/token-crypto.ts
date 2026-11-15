import {
  decryptTotpSecret,
  encryptTotpSecret,
} from "../auth-security.js";

/** Reuses the TOTP AES key so OAuth refresh tokens stay encrypted at rest. */
export function encryptIntegrationSecret(value: string) {
  return encryptTotpSecret(value);
}

export function decryptIntegrationSecret(encrypted: string) {
  return decryptTotpSecret(encrypted);
}
