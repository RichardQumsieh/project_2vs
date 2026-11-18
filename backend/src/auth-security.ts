import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  generateSecret,
  generateURI,
  verify,
} from "otplib";
import { env, gmailConfigured } from "./env.js";

const totpEncryptionKey = Buffer.from(
  env.TOTP_ENCRYPTION_KEY,
  "hex",
);

export function hashToken(token: string) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function createRecoveryCodes() {
  return Array.from(
    { length: 10 },
    () => {
      const raw = randomBytes(10).toString("hex").toUpperCase();
      return [
        raw.slice(0, 4),
        raw.slice(4, 8),
        raw.slice(8, 12),
        raw.slice(12, 16),
        raw.slice(16, 20),
      ].join("-");
    },
  );
}

export function hashRecoveryCode(code: string) {
  return hashToken(
    code.replace(/[-\s]/g, "").toUpperCase(),
  );
}

export async function verifyTotp(
  secret: string,
  token: string,
) {
  if (!/^\d{6}$/.test(token)) {
    return false;
  }

  const result = await verify({
    secret,
    token,
    algorithm: "sha1",
    digits: 6,
    period: 30,
    epochTolerance: 30,
  });

  return result.valid;
}

export function beginTotpSetup(email: string) {
  const secret = generateSecret({ length: 20 });

  return {
    secret,
    otpauthUrl: generateURI({
      issuer: "Sophia",
      label: email,
      secret,
      algorithm: "sha1",
      digits: 6,
      period: 30,
    }),
  };
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    totpEncryptionKey,
    iv,
  );

  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(encrypted: string) {
  const [ivPart, tagPart, ciphertextPart] =
    encrypted.split(".");

  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid encrypted TOTP secret");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    totpEncryptionKey,
    Buffer.from(ivPart, "base64url"),
  );

  decipher.setAuthTag(
    Buffer.from(tagPart, "base64url"),
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(ciphertextPart, "base64url"),
    ),
    decipher.final(),
  ]).toString("utf8");
}

async function gmailAccessToken() {
  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID!,
        client_secret: env.GMAIL_CLIENT_SECRET!,
        refresh_token: env.GMAIL_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gmail OAuth token request failed with status ${response.status}`,
    );
  }

  const result: unknown = await response.json();

  if (
    typeof result !== "object" ||
    result === null ||
    !("access_token" in result) ||
    typeof result.access_token !== "string"
  ) {
    throw new Error("Gmail OAuth response did not include an access token");
  }

  return result.access_token;
}

export async function sendPasswordResetEmail(
  recipient: string,
  resetUrl: string,
) {
  if (!gmailConfigured) {
    throw new Error("Gmail API is not configured");
  }

  const accessToken = await gmailAccessToken();
  const rawMessage = [
    `From: Sophia <${env.GMAIL_SENDER}>`,
    `To: ${recipient}`,
    "Subject: Reset your Sophia password",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "A password reset was requested for your account.",
    "",
    `Open this one-time link within 30 minutes: ${resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
    "Your authenticator code is also required to complete the reset.",
  ].join("\r\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: Buffer.from(rawMessage).toString("base64url"),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gmail API send request failed with status ${response.status}`,
    );
  }

}
