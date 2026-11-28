import CookieManager from "@preeternal/react-native-cookie-manager";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://api.sophia-build.com").replace(/\/$/, "");
export const WEB_URL = (process.env.EXPO_PUBLIC_SOPHIA_WEB_URL || "https://sophia.apps.grok.bot").replace(/\/$/, "");
const REQUEST_ORIGIN = new URL(WEB_URL).origin;
const COOKIE_KEY = "sophia_api_session";
const COOKIE_NAME = "messenger_session";
const cookieOptions = Platform.OS === "ios" ? { iosCookieStore: "webKit" as const } : undefined;
let activeApiCookie: string | null = null;

export function setApiCookie(cookie: string | null) {
  activeApiCookie = cookie;
}

export async function getApiCookie() {
  if (activeApiCookie) return activeApiCookie;
  activeApiCookie = await SecureStore.getItemAsync(COOKIE_KEY);
  return activeApiCookie;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function persistCookieFromHeader(header: string | null) {
  if (!header) return;
  const token = header.match(new RegExp(`(?:^|[,;]\\s*)${COOKIE_NAME}=([^;,\\s]+)`))?.[1];
  if (!token) return;
  activeApiCookie = token;
  await SecureStore.setItemAsync(COOKIE_KEY, token);
  await CookieManager.set(API_URL, {
    name: COOKIE_NAME,
    value: token,
    path: "/",
    secure: API_URL.startsWith("https://"),
    httpOnly: true,
    sameSite: API_URL.startsWith("https://") ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60,
  }, cookieOptions);
}

export async function restoreApiCookie() {
  const token = await SecureStore.getItemAsync(COOKIE_KEY);
  if (!token) return null;
  activeApiCookie = token;
  await CookieManager.set(API_URL, {
    name: COOKIE_NAME,
    value: token,
    path: "/",
    secure: API_URL.startsWith("https://"),
    httpOnly: true,
    sameSite: API_URL.startsWith("https://") ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60,
  }, cookieOptions);
  return token;
}

export async function clearApiCookie() {
  activeApiCookie = null;
  await SecureStore.deleteItemAsync(COOKIE_KEY);
  await CookieManager.clearByName(API_URL, COOKIE_NAME, cookieOptions).catch(() => false);
}

export async function request<T>(path: string, options: RequestInit = {}, cookie?: string | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        // React Native requests have no browser page origin. Use Sophia's
        // published web origin so the API's CSRF origin check recognizes this
        // first-party native client without opening the server allowlist.
        Origin: REQUEST_ORIGIN,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...((cookie ?? activeApiCookie) ? { Cookie: `${COOKIE_NAME}=${cookie ?? activeApiCookie}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(`Can’t reach Sophia at ${new URL(API_URL).host}. Check your connection and try again.`, 0);
  }
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  await persistCookieFromHeader(response.headers.get("set-cookie"));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, typeof data?.code === "string" ? data.code : undefined);
  }
  return data as T;
}

export type User = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarConfig?: unknown;
  greetingText?: string | null;
  greetingAnimation?: string | null;
};
export type TotpSetup = { setupRequired: true; setupToken: string; secret: string; otpauthUrl: string };
export type SessionUser = User & { vaultVersion: number; interests: string[] };
export type Conversation = {
  id: string; type: "DIRECT" | "GROUP"; title?: string | null; createdAt?: string; memberUserIds?: string[];
  members?: { userId: string; username: string; displayName: string | null; avatarUrl?: string | null; avatarConfig?: unknown; greetingText?: string | null; greetingAnimation?: string | null; role: "ADMIN" | "MEMBER"; readCursor?: { blobId: string; createdAt: string } | null }[];
  updatedAt: string; peer: User | null; lastMessageAt: string | null; unreadCount?: number;
};
export type Task = {
  id: string; title: string; dueAt: string | null; status: "OPEN" | "DONE" | "DISMISSED";
  source: "MANUAL" | "RADAR"; projectId: string | null; createdAt: string; updatedAt: string;
};
export type DailyBrief = {
  enabled: true;
  preference: { briefTime: string; language: "en" | "ar"; timeZone: string };
  pendingReason: "before_brief_time" | "not_connected" | null;
  brief: {
    localDate: string; narrative: string; mode: "mock" | "live";
    meetings: { id: string; title: string; startsAt: string; endsAt: string; prepNote: string; conflictsWith: string[] }[];
    needsReply: { id: string; subject: string; fromAddress: string; urgency: "high" | "medium" | "low"; reason: string }[];
    overdueFollowUps: { id: string; subject: string; fromAddress: string; daysOverdue: number }[];
    actions: { id: string; title: string; detail: string; approvalRequired: true }[];
  } | null;
};
export type Workspace = {
  id: string; name: string; kind: "FAMILY" | "TEAM"; role: "OWNER" | "ADMIN" | "MEMBER";
  seatCount: number; seatLimit: number; dailyBrief: boolean; billingStatus: string; billingEnabled: boolean;
};
export type WorkspaceMember = { userId: string; username: string; displayName: string | null; role: "OWNER" | "ADMIN" | "MEMBER"; joinedAt: string };
export type WorkspaceInvite = { id: string; hint: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null; createdAt: string };

export const api = {
  login: (body: { email: string; password: string; code?: string }) => request<
    | { mfaRequired: true; reason: "new_browser" | "network_changed" }
    | TotpSetup
    | { setupRequired: false; user: User }
  >("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  register: (body: { username: string; displayName: string; email: string; password: string; passwordConfirm: string }) =>
    request<TotpSetup>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  confirmTotp: (body: { setupToken: string; code: string }) =>
    request<{ user: User; recoveryCodes: string[] }>("/auth/totp/confirm", { method: "POST", body: JSON.stringify(body) }),
  me: (cookie: string) => request<{ user: SessionUser; devices: { id: string; deviceName: string }[] }>("/me", {}, cookie),
  updateAvatar: (cookie: string, body: { avatarConfig: unknown; greetingText: string | null; greetingAnimation: string | null }) =>
    request<{ user: User }>("/me/avatar", { method: "PATCH", body: JSON.stringify(body) }, cookie),
  logout: (cookie: string) => request("/auth/logout", { method: "POST" }, cookie),
  conversations: (cookie: string) => request<{ conversations: Conversation[] }>("/conversations", {}, cookie),
  lookupPeople: (cookie: string, query: string) => request<{ users: User[] }>(`/users/lookup?q=${encodeURIComponent(query)}`, {}, cookie),
  searchPeople: (query: string) => request<{ users: User[] }>(`/users/lookup?q=${encodeURIComponent(query)}`),
  addGroupMember: (conversationId: string, userId: string) => request<{ ok: true }>(`/conversations/${encodeURIComponent(conversationId)}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
  removeGroupMember: (conversationId: string, userId: string) => request<{ ok: true }>(`/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  setGroupMemberRole: (conversationId: string, userId: string, role: "ADMIN" | "MEMBER") => request<{ ok: true }>(`/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  createDirect: (cookie: string, username: string) => request<Conversation>("/conversations/direct", { method: "POST", body: JSON.stringify({ username }) }, cookie),
  createGroup: (cookie: string, body: { memberUserIds: string[]; title?: string }) => request<Conversation>("/conversations/group", { method: "POST", body: JSON.stringify(body) }, cookie),
  groupDevices: (conversationId: string) => request<{ devices: { userId: string; deviceId: string; signingPublicKey: string; role: "admin" | "member"; username: string; displayName: string | null }[] }>(`/conversations/${encodeURIComponent(conversationId)}/group-devices`),
  groupMls: (conversationId: string, deviceId: string, after?: string) => request<{ blobs: { id: string; clientId: string | null; kind: "key_package" | "welcome" | "commit" | "proposal" | "application"; senderDeviceId: string; recipientDeviceId: string | null; payload: string; bindingSignature: string | null; createdAt: string }[] }>(`/conversations/${encodeURIComponent(conversationId)}/mls?deviceId=${encodeURIComponent(deviceId)}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`),
  postGroupMls: (conversationId: string, body: { senderDeviceId: string; clientId?: string; kind: "key_package" | "welcome" | "commit" | "proposal" | "application"; payload: string; recipientDeviceId?: string; bindingSignature?: string }) => request<{ id: string; kind: string; payload: string; createdAt?: string }>(`/conversations/${encodeURIComponent(conversationId)}/mls`, { method: "POST", body: JSON.stringify(body) }),
  renameGroup: (conversationId: string, title: string) => request<{ ok: true; title: string }>(`/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  markGroupRead: (conversationId: string, blobId?: string) => request<{ ok: true; blobId: string | null }>(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST", body: JSON.stringify(blobId ? { blobId } : {}) }),
  messages: (conversationId: string, deviceId: string, before?: { createdAt: string; id: string }, fromStart = false, after?: string, limit = 50) => {
    const query = new URLSearchParams({ deviceId, limit: String(limit) });
    if (after) query.set("after", after);
    if (fromStart) query.set("fromStart", "true");
    if (before) { query.set("before", before.createdAt); query.set("beforeId", before.id); }
    return request<{ messages: import("../../frontend/lib/crypto/types").WireMessage[] }>(`/conversations/${encodeURIComponent(conversationId)}/messages?${query}`);
  },
  sendMessage: (conversationId: string, body: {
    senderDeviceId: string; logicalMessageId: string;
    envelopes: { recipientDeviceId: string; ciphertext: string; nonce: string; ratchetHeader: unknown }[];
    archiveEnvelopes: { ownerUserId: string; recipientPublicKey: string; ephemeralPublicKey: string; nonce: string; ciphertext: string }[];
  }) => request<{ logicalMessageId: string; createdAt: string }>(`/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify(body) }),
  deleteMessage: (conversationId: string, logicalMessageId: string) => request<{ ok: true; logicalMessageId: string }>(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(logicalMessageId)}`, { method: "DELETE" }),
  deletedMessages: (conversationId: string, after?: string) => request<{ deletions: { logicalMessageId: string; messageRecordIds: string[] }[] }>(`/conversations/${encodeURIComponent(conversationId)}/message-deletions?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`),
  tasks: (cookie: string) => request<{ tasks: Task[] }>("/tasks", {}, cookie),
  createTask: (cookie: string, title: string) => request<{ task: Task }>("/tasks", { method: "POST", body: JSON.stringify({ title }) }, cookie),
  updateTask: (cookie: string, id: string, status: Task["status"]) => request<{ task: Task }>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }, cookie),
  dailyBrief: (cookie: string) => request<DailyBrief>("/daily-brief", {}, cookie),
  generateBrief: (cookie: string) => request<DailyBrief>("/daily-brief", { method: "POST" }, cookie),
  workspaces: (cookie: string) => request<{ workspaces: Workspace[] }>("/workspaces", {}, cookie),
  createWorkspace: (cookie: string, name: string, kind: Workspace["kind"]) => request<{ workspace: Workspace }>("/workspaces", { method: "POST", body: JSON.stringify({ name, kind }) }, cookie),
  workspaceDetail: (cookie: string, id: string) => request<{ workspace: Workspace; members: WorkspaceMember[]; invites: WorkspaceInvite[] }>(`/workspaces/${encodeURIComponent(id)}`, {}, cookie),
  addWorkspaceMember: (cookie: string, id: string, username: string) => request<{ member: WorkspaceMember }>(`/workspaces/${encodeURIComponent(id)}/members`, { method: "POST", body: JSON.stringify({ username }) }, cookie),
  createWorkspaceInvite: (cookie: string, id: string) => request<{ invite: { id: string; code: string; hint: string; expiresAt: string; path: string } }>(`/workspaces/${encodeURIComponent(id)}/invites`, { method: "POST", body: JSON.stringify({}) }, cookie),
  revokeWorkspaceInvite: (cookie: string, id: string, inviteId: string) => request<{ ok: true }>(`/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }, cookie),
  workspaceDirect: (cookie: string, id: string, username: string) => request<Conversation>(`/workspaces/${encodeURIComponent(id)}/conversations/direct`, { method: "POST", body: JSON.stringify({ username }) }, cookie),
  workspaceGroup: (cookie: string, id: string, body: { title?: string; memberUserIds: string[] }) => request<Conversation>(`/workspaces/${encodeURIComponent(id)}/conversations/group`, { method: "POST", body: JSON.stringify(body) }, cookie),
  cloudConsent: (cookie: string) => request<{ active: boolean; purposeText: string; versionId: string }>("/sophia/cloud/consent", {}, cookie),
  grantCloudConsent: (cookie: string, purposeText: string, versionId: string) => request("/sophia/cloud/consent", { method: "POST", body: JSON.stringify({ accepted: true, purposeText, versionId }) }, cookie),
  completeCloudSophia: (cookie: string, prompt: string) => request<{ reply: string }>("/sophia/cloud/complete", { method: "POST", body: JSON.stringify({ prompt }) }, cookie),
  mediaUpload: (
    conversationId: string,
    byteSize: number,
    kind: "photo" | "video" | "voice" | "file",
  ) =>
    request<{
      mediaId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }>(`/conversations/${encodeURIComponent(conversationId)}/media`, {
      method: "POST",
      body: JSON.stringify({ byteSize, kind }),
    }),
  mediaDownload: async (conversationId: string, mediaId: string) => {
    const result = await request<{ downloadUrl: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(mediaId)}/download`,
      { method: "POST" },
    );
    let downloadUrl: URL;
    try {
      if (typeof result.downloadUrl !== "string") {
        throw new TypeError("Expected a download URL string.");
      }
      downloadUrl = new URL(result.downloadUrl);
    } catch {
      throw new ApiError("The media service returned an invalid download URL.", 502);
    }
    if (
      downloadUrl.protocol !== "https:" ||
      !downloadUrl.hostname.endsWith(".backblazeb2.com") ||
      downloadUrl.username ||
      downloadUrl.password
    ) {
      throw new ApiError("The media service returned an untrusted download URL.", 502);
    }
    return result;
  },
  checkUrlSafety: (urls: string[]) =>
    request<{
      results: {
        url: string;
        status: "clean" | "threat" | "unverifiable" | "unavailable";
        threatTypes: string[];
      }[];
    }>("/url-safety/check", {
      method: "POST",
      body: JSON.stringify({ urls }),
    }),
  callIceServers: () =>
    request<{ iceServers: { urls?: string | string[]; username?: string; credential?: string }[] }>("/calls/ice-servers"),
};

export function wsUrl() {
  const url = new URL(API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

export function openSignalingSocket() {
  const Socket = WebSocket as unknown as new (
    url: string,
    protocols?: string[] | null,
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  const cookie = activeApiCookie;
  return new Socket(wsUrl(), null, {
    headers: {
      Origin: REQUEST_ORIGIN,
      ...(cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {}),
    },
  });
}
