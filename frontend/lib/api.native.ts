import { request } from "../../mobile/src/api";
import type { AccountArchiveKeyRecord, NewAccountArchiveKeyRecord } from "./crypto/account-archive";
import type { WireMessage } from "./crypto/types";

type EncryptedBackupRecord = {
  recordId: string;
  conversationId?: string;
  createdAt?: string;
  nonce: string;
  ciphertext: string;
};

type AccountArchiveRecord = {
  logicalMessageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
};

export type { EncryptedBackupRecord };

export const api = {
  me: () => request<{
    user: { id: string; vaultVersion: number };
    devices: { id: string; deviceName: string }[];
  }>("/me"),

  registerDevice: (body: unknown) => request<{ deviceId: string }>("/devices", {
    method: "POST", body: JSON.stringify(body),
  }),

  saveRecoveryRecords: (deviceId: string, kind: "message" | "session", records: EncryptedBackupRecord[]) =>
    request<{ ok: true }>(`/devices/${encodeURIComponent(deviceId)}/recovery-records/${kind}`, {
      method: "POST", body: JSON.stringify({ records }),
    }),

  recoveryRecords: (deviceId: string, kind: "message" | "session", after?: string) =>
    request<{ records: { recordId: string; conversationId: string | null; payload: { nonce: string; ciphertext: string; createdAt?: string } }[] }>(
      `/devices/${encodeURIComponent(deviceId)}/recovery-records?kind=${kind}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    ),

  saveRecoveryVault: (deviceId: string, vault: { userId?: string; version: number; salt: string; nonce: string; ciphertext: string }) =>
    request<{ ok: true }>(`/devices/${encodeURIComponent(deviceId)}/recovery-vault`, {
      method: "PUT", body: JSON.stringify({ vault }),
    }),

  accountArchiveKey: () => request<{ key: AccountArchiveKeyRecord | null }>("/account-archive/key"),

  createAccountArchiveKey: (key: NewAccountArchiveKeyRecord) => request<{ ok: true }>("/account-archive/key", {
    method: "PUT", body: JSON.stringify({ key }),
  }),

  rewrapAccountArchivePassword: (
    recoveryCodeHash: string,
    passwordWrap: { passwordSalt: string; passwordNonce: string; passwordEncryptedPrivateKey: string },
  ) => request<{ ok: true }>("/account-archive/key/password-wrap", {
    method: "PUT", body: JSON.stringify({ recoveryCodeHash, ...passwordWrap }),
  }),

  archivePublicKeys: (conversationId: string) => request<{ keys: { userId: string; publicKey: string }[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/archive-keys`,
  ),

  archiveMessages: (conversationId: string, after?: string, limit = 100) => request<{ records: AccountArchiveRecord[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/archive-messages?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
  ),

  saveAccountArchiveMessages: (records: AccountArchiveRecord[]) => request<{ ok: true }>("/account-archive/messages", {
    method: "POST", body: JSON.stringify({ records }),
  }),

  recipientDevices: (conversationId: string, senderDeviceId: string) => request<{
    devices: { deviceId: string; username: string }[];
  }>(`/conversations/${encodeURIComponent(conversationId)}/recipient-devices?senderDeviceId=${encodeURIComponent(senderDeviceId)}`),

  prekeyBundle: (username: string, deviceId?: string) => request<{
    user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
    deviceId: string;
    identityPublicKey: string;
    signingPublicKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySig: string;
    oneTimePreKey: { keyId: number; publicKey: string } | null;
  }>(`/users/${encodeURIComponent(username)}/prekey-bundle${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ""}`),

  conversations: () => request<{ conversations: { id: string; type: "DIRECT" | "GROUP"; peer: { id: string } | null }[] }>("/conversations"),

  messages: (
    conversationId: string,
    deviceId: string,
    before?: { createdAt: string; id: string },
    fromStart = false,
    after?: string,
    limit = 50,
  ) => {
    const query = new URLSearchParams({ deviceId, limit: String(limit) });
    if (after) query.set("after", after);
    if (fromStart) query.set("fromStart", "true");
    if (before) { query.set("before", before.createdAt); query.set("beforeId", before.id); }
    return request<{ messages: WireMessage[] }>(`/conversations/${encodeURIComponent(conversationId)}/messages?${query}`);
  },

  deletedMessages: (conversationId: string, after?: string, limit = 100) => request<{
    deletions: { logicalMessageId: string; messageRecordIds: string[]; deletedAt: string }[];
  }>(`/conversations/${encodeURIComponent(conversationId)}/message-deletions?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`),
};
