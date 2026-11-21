import { resolveApiUrl } from "./api-url";
import type { DailyBriefResponse } from "./daily-brief/types";
import { assertGroupE2eeEnabled } from "./group-e2ee-flag";
import { assertSafetyNumbersEnabled } from "./safety-numbers-flag";
import type { IdentityDirectory } from "./crypto/safety-view";
import type { OutboundEmailAttachment } from "./email-attachments";

const API_URL = resolveApiUrl();

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${API_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "include",
      headers: {
        ...(init?.body
          ? {
              "Content-Type":
                "application/json",
            }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    const method = init?.method ?? "GET";
    let origin = API_URL;
    try {
      origin = new URL(API_URL).origin;
    } catch {
      origin = "the configured API URL";
    }
    throw new ApiError(
      `Could not connect to the API at ${origin} (${method} ${path}). Check that the API is reachable from this browser and allows this app's origin.`,
      0,
    );
  }

  const contentType =
    response.headers.get(
      "content-type",
    ) ?? "";

  let data: unknown = null;

  if (
    contentType.includes(
      "application/json",
    )
  ) {
    data = await response
      .json()
      .catch(() => null);
  } else {
    const text =
      await response.text();

    data = text || null;
  }

  if (!response.ok) {
    let message =
      `Request failed with status ${response.status}`;

    if (
      typeof data === "object" &&
      data !== null &&
      "error" in data
    ) {
      const error =
        (data as {
          error?: unknown;
        }).error;

      if (typeof error === "string") {
        message = error;
      }
    }

    const code = typeof data === "object" && data !== null && "code" in data &&
      typeof (data as { code?: unknown }).code === "string"
      ? (data as { code: string }).code
      : undefined;
    throw new ApiError(
      message,
      response.status,
      code,
    );
  }

  return data as T;
}

export type PublicUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type AccountActivityEvent = {
  id: string;
  actorUserId: string;
  actor: string;
  occurredAt: string;
  action: string;
  summary: string;
  subjectKind: string | null;
  subjectId: string | null;
};

export type AccountActivityExport = {
  version: 1;
  exportedAt: string;
  ownerUserId: string;
  truncated: boolean;
  events: AccountActivityEvent[];
};

export type RecommendedUser = PublicUser & {
  interests: string[];
  sharedInterestCount: number;
};

export type TotpSetup = {
  setupRequired: true;
  setupToken: string;
  secret: string;
  otpauthUrl: string;
};

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: "FAMILY" | "TEAM";
  planId: string;
  role: WorkspaceRole;
  seatCount: number;
  seatLimit: number;
  dailyBrief: boolean;
  billingStatus: string;
  billingEnabled: boolean;
  billingProvider: string;
};

export type WorkspaceMemberRow = {
  userId: string;
  username: string;
  displayName: string | null;
  role: WorkspaceRole;
  joinedAt: string;
};

export type WorkspaceInviteRow = {
  id: string;
  hint: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type Conversation = {
  id: string;
  type: "DIRECT" | "GROUP";
  title?: string | null;
  memberUserIds?: string[];
  members?: {
    userId: string;
    username: string;
    displayName: string | null;
    role: "ADMIN" | "MEMBER";
  }[];
  updatedAt: string;
  peer: PublicUser | null;
  lastMessageAt: string | null;
  unreadCount?: number;
};

export type EncryptedBackupRecord = {
  recordId: string;
  conversationId?: string;
  createdAt?: string;
  nonce: string;
  ciphertext: string;
};

export type AccountArchiveRecord = {
  logicalMessageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
};

export type MessageDeletion = {
  logicalMessageId: string;
  messageRecordIds: string[];
  deletedAt: string;
};

async function approveMailCalendarWrite(input: {
  idempotencyKey: string;
  action: "send_email" | "save_draft" | "reschedule_event" | "delete_event";
  provider: string;
  payload: unknown;
}) {
  const proposed = await request<{
    ok: true;
    id: string;
    status: string;
  }>("/integrations/writes/proposals", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      action: input.action,
      provider: input.provider,
      payload: input.payload,
    }),
  });
  return request<{
    ok: true;
    replayed: boolean;
    externalId: string | null;
    htmlLink: string | null;
  }>(
    `/integrations/writes/proposals/${encodeURIComponent(proposed.id)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ payload: input.payload }),
    },
  );
}

export const api = {
  register: (body: {
    username: string;
    email: string;
    password: string;
    passwordConfirm: string;
    displayName?: string;
    cloudSophiaConsent?: {
      accepted: true;
      purposeText: string;
      versionId: string;
    };
  }) =>
    request<TotpSetup>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  login: (body: {
    email: string;
    password: string;
    code?: string;
    trustBrowser?: boolean;
  }) =>
    request<
      TotpSetup |
      {
        mfaRequired: true;
        reason: "new_browser" | "network_changed";
      } |
      {
        setupRequired: false;
        user: PublicUser;
      }
    >(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  confirmTotp: (body: {
    setupToken: string;
    code: string;
    trustBrowser?: boolean;
  }) =>
    request<{
      user: PublicUser;
      recoveryCodes: string[];
    }>(
      "/auth/totp/confirm",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  requestPasswordReset: (email: string) =>
    request<{ ok: true; message: string }>(
      "/auth/password/forgot",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    ),

  resetPassword: (body: {
    token: string;
    password: string;
    passwordConfirm: string;
    code: string;
  }) =>
    request<{
      ok: true;
      vaultResetRequired: true;
    }>(
      "/auth/password/reset",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  logout: () =>
    request<{ ok: true }>("/auth/logout", {
      method: "POST",
    }),

  me: () =>
    request<{
      user: PublicUser & { vaultVersion: number; interests: string[] };
      devices: {
        id: string;
        deviceName: string;
      }[];
    }>("/me"),

  updateProfile: (interests: string[]) =>
    request<{
      user: PublicUser & { interests: string[] };
    }>("/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ interests }),
    }),

  lookupPeople: (query: string) =>
    request<{ users: PublicUser[] }>(`/users/lookup?q=${encodeURIComponent(query)}`),

  recommendations: () =>
    request<{ users: RecommendedUser[] }>("/users/recommendations"),

  registerDevice: (body: unknown) =>
    request<{ deviceId: string }>(
      "/devices",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  recoveryVaults: () =>
    request<{
      backups: {
        deviceId: string;
        payload: {
          userId?: string;
          version: number;
          salt: string;
          nonce: string;
          ciphertext: string;
        };
        updatedAt: string;
      }[];
    }>("/devices/recovery-vaults"),

  saveRecoveryVault: (
    deviceId: string,
    vault: {
      userId?: string;
      version: number;
      salt: string;
      nonce: string;
      ciphertext: string;
    },
  ) =>
    request<{ ok: true }>(
      `/devices/${encodeURIComponent(deviceId)}/recovery-vault`,
      { method: "PUT", body: JSON.stringify({ vault }) },
    ),

  recoveryRecords: (
    deviceId: string,
    kind: "message" | "session",
    after?: string,
  ) =>
    request<{
      records: {
        recordId: string;
        conversationId: string | null;
        payload: {
          nonce: string;
          ciphertext: string;
          createdAt?: string;
        };
      }[];
    }>(
      `/devices/${encodeURIComponent(deviceId)}/recovery-records?${new URLSearchParams({
        kind,
        ...(after ? { after } : {}),
      })}`,
    ),

  saveRecoveryRecords: (
    deviceId: string,
    kind: "message" | "session",
    records: EncryptedBackupRecord[],
  ) =>
    request<{ ok: true }>(
      `/devices/${encodeURIComponent(deviceId)}/recovery-records/${kind}`,
      { method: "POST", body: JSON.stringify({ records }) },
    ),

  accountArchiveKey: () =>
    request<{
      key: import("./crypto/account-archive").AccountArchiveKeyRecord | null;
    }>("/account-archive/key"),

  createAccountArchiveKey: (
    key: import("./crypto/account-archive").NewAccountArchiveKeyRecord,
  ) =>
    request<{ ok: true }>("/account-archive/key", {
      method: "PUT",
      body: JSON.stringify({ key }),
    }),

  rewrapAccountArchivePassword: (
    recoveryCodeHash: string,
    passwordWrap: {
      passwordSalt: string;
      passwordNonce: string;
      passwordEncryptedPrivateKey: string;
    },
  ) =>
    request<{ ok: true }>("/account-archive/key/password-wrap", {
      method: "PUT",
      body: JSON.stringify({ recoveryCodeHash, ...passwordWrap }),
    }),

  archivePublicKeys: (conversationId: string) =>
    request<{
      keys: { userId: string; publicKey: string }[];
    }>(`/conversations/${encodeURIComponent(conversationId)}/archive-keys`),

  archiveMessages: (
    conversationId: string,
    after?: string,
    limit = 100,
  ) =>
    request<{ records: AccountArchiveRecord[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/archive-messages?${new URLSearchParams({
        limit: String(limit),
        ...(after ? { after } : {}),
      })}`,
    ),

  saveAccountArchiveMessages: (
    records: AccountArchiveRecord[],
  ) =>
    request<{ ok: true }>("/account-archive/messages", {
      method: "POST",
      body: JSON.stringify({ records }),
    }),

  recipientDevices: (conversationId: string, senderDeviceId: string) =>
    request<{
      devices: {
        deviceId: string;
        username: string;
      }[];
    }>(
      `/conversations/${encodeURIComponent(conversationId)}/recipient-devices?senderDeviceId=${encodeURIComponent(senderDeviceId)}`,
    ),

  prekeyBundle: (
    username: string,
    deviceId?: string,
  ) =>
    request<{
      user: PublicUser;
      deviceId: string;
      identityPublicKey: string;
      signingPublicKey: string;
      signedPreKeyId: number;
      signedPreKey: string;
      signedPreKeySig: string;
      oneTimePreKey: {
        keyId: number;
        publicKey: string;
      } | null;
    }>(
      `/users/${encodeURIComponent(
        username,
      )}/prekey-bundle${
        deviceId
          ? `?deviceId=${encodeURIComponent(deviceId)}`
          : ""
      }`,
    ),

  conversations: () =>
    request<{
      conversations: Conversation[];
    }>("/conversations"),

  identityKeys: (conversationId: string) => {
    assertSafetyNumbersEnabled();
    return request<IdentityDirectory>(
      `/conversations/${encodeURIComponent(conversationId)}/identity-keys`,
    );
  },

  createDirect: (
    username: string,
  ) =>
    request<Conversation>(
      "/conversations/direct",
      {
        method: "POST",
        body: JSON.stringify({
          username,
        }),
      },
    ),

  createGroup: (body: { memberUserIds?: string[]; memberUsernames?: string[]; title?: string }) => {
    assertGroupE2eeEnabled();
    return request<Conversation>("/conversations/group", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  addGroupMember: (
    conversationId: string,
    body: { userId?: string; username?: string; role?: "ADMIN" | "MEMBER" },
  ) => {
    assertGroupE2eeEnabled();
    return request<{ ok: true; members: { userId: string; role: "ADMIN" | "MEMBER" }[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/members`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  removeGroupMember: (conversationId: string, userId: string) => {
    assertGroupE2eeEnabled();
    return request<{ ok: true; members: { userId: string; role: "ADMIN" | "MEMBER" }[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  },

  setGroupMemberRole: (conversationId: string, userId: string, role: "ADMIN" | "MEMBER") => {
    assertGroupE2eeEnabled();
    return request<{ ok: true; members: { userId: string; role: "ADMIN" | "MEMBER" }[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
  },

  markGroupRead: (conversationId: string, blobId?: string) => {
    assertGroupE2eeEnabled();
    return request<{ ok: true; blobId: string | null }>(
      `/conversations/${encodeURIComponent(conversationId)}/read`,
      { method: "POST", body: JSON.stringify(blobId ? { blobId } : {}) },
    );
  },

  groupDevices: (conversationId: string) => {
    assertGroupE2eeEnabled();
    return request<{
      devices: {
        userId: string;
        deviceId: string;
        signingPublicKey: string;
        role: "admin" | "member";
        username: string;
        displayName: string | null;
      }[];
    }>(`/conversations/${encodeURIComponent(conversationId)}/group-devices`);
  },

  postGroupMls: (
    conversationId: string,
    body: {
      senderDeviceId: string;
      clientId?: string;
      kind: "key_package" | "welcome" | "commit" | "proposal" | "application";
      payload: string;
      recipientDeviceId?: string;
      bindingSignature?: string;
    },
  ) => {
    assertGroupE2eeEnabled();
    return request<{ id: string; kind: string; payload: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/mls`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  groupMls: (conversationId: string, deviceId: string, after?: string) => {
    assertGroupE2eeEnabled();
    return request<{
      blobs: {
        id: string;
        clientId: string | null;
        kind: "key_package" | "welcome" | "commit" | "proposal" | "application";
        senderDeviceId: string;
        recipientDeviceId: string | null;
        payload: string;
        bindingSignature: string | null;
        createdAt: string;
      }[];
    }>(
      `/conversations/${encodeURIComponent(conversationId)}/mls?${new URLSearchParams({
        deviceId,
        limit: "100",
        ...(after ? { after } : {}),
      })}`,
    );
  },

  messages: (
    conversationId: string,
    deviceId: string,
    before?: { createdAt: string; id: string },
    fromStart = false,
    after?: string,
    limit = 50,
  ) =>
    request<{
      messages: import("./crypto/types").WireMessage[];
    }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages?${new URLSearchParams({
        deviceId,
        limit: String(limit),
        ...(after ? { after } : {}),
        ...(fromStart ? { fromStart: "true" } : {}),
        ...(before
          ? { before: before.createdAt, beforeId: before.id }
          : {}),
      })}`,
    ),

  deletedMessages: (conversationId: string, after?: string, limit = 100) =>
    request<{ deletions: MessageDeletion[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/message-deletions?${new URLSearchParams({
        limit: String(limit),
        ...(after ? { after } : {}),
      })}`,
    ),

  deleteMessage: (conversationId: string, logicalMessageId: string) =>
    request<{ ok: true; logicalMessageId: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(logicalMessageId)}`,
      { method: "DELETE" },
    ),

  sendMessage: (
    conversationId: string,
    body: {
      senderDeviceId: string;
      logicalMessageId: string;
      envelopes: {
        recipientDeviceId: string;
        ciphertext: string;
        nonce: string;
        ratchetHeader: unknown;
      }[];
      archiveEnvelopes: {
        ownerUserId: string;
        recipientPublicKey: string;
        ephemeralPublicKey: string;
        nonce: string;
        ciphertext: string;
      }[];
    },
  ) =>
    request<{
      logicalMessageId: string;
      createdAt: string;
    }>(
      `/conversations/${encodeURIComponent(
        conversationId,
      )}/messages`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

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
    request<{ iceServers: RTCIceServer[] }>("/calls/ice-servers"),

    researchSearch: (query: string, signal?: AbortSignal) =>
      request<{
        sources: {
          title: string;
          url: string;
          excerpt: string;
        }[];
      }>("/research/search", {
        method: "POST",
        body: JSON.stringify({ query }),
        signal,
      }),

  listTasks: () =>
    request<{
      tasks: {
        id: string;
        title: string;
        dueAt: string | null;
        status: "OPEN" | "DONE" | "DISMISSED";
        source: "MANUAL" | "RADAR";
        clientDraftId: string | null;
        conversationId: string | null;
        projectId: string | null;
        createdAt: string;
        updatedAt: string;
      }[];
    }>("/tasks"),

  createTask: (body: {
    title: string;
    dueAt?: string;
    projectId?: string;
    source?: "MANUAL" | "RADAR";
    clientDraftId?: string;
    conversationId?: string;
    status?: "OPEN" | "DONE" | "DISMISSED";
  }) =>
    request<{
      task: {
        id: string;
        title: string;
        dueAt: string | null;
        status: "OPEN" | "DONE" | "DISMISSED";
        source: "MANUAL" | "RADAR";
        clientDraftId: string | null;
        conversationId: string | null;
        projectId: string | null;
        createdAt: string;
        updatedAt: string;
      };
      deduped?: boolean;
    }>("/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listProjects: () =>
    request<{
      projects: {
        id: string;
        name: string;
        createdAt: string;
        updatedAt: string;
      }[];
    }>("/projects"),

  createProject: (body: { name: string }) =>
    request<{
      project: {
        id: string;
        name: string;
        createdAt: string;
        updatedAt: string;
      };
    }>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listReminders: () =>
    request<{
      reminders: {
        id: string;
        taskId: string | null;
        remindAt: string;
        status: "SCHEDULED" | "CANCELLED" | "FIRED";
        createdAt: string;
        updatedAt: string;
      }[];
    }>("/reminders"),

  createReminder: (body: { remindAt: string; taskId?: string }) =>
    request<{
      reminder: {
        id: string;
        taskId: string | null;
        remindAt: string;
        status: "SCHEDULED" | "CANCELLED" | "FIRED";
        createdAt: string;
        updatedAt: string;
      };
    }>("/reminders", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  calendarIntegrationStatus: () =>
    request<{
      providers: {
        google: {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
        outlook: {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
      };
      writesEnabled: boolean;
      privacy: {
        storesChatPlaintext: boolean;
        aiUsesCalendarBodiesByDefault: boolean;
        note: string;
      };
    }>("/integrations/calendar/status"),

  listCalendarConnections: () =>
    request<{
      connections: {
        id: string;
        provider:
          | "GOOGLE_CALENDAR"
          | "OUTLOOK_CALENDAR"
          | "GMAIL"
          | "OUTLOOK_MAIL"
          | "GITHUB"
          | "LINEAR"
          | "SLACK";
        accountEmail: string | null;
        scopes: string[];
        status: "CONNECTED" | "REVOKED" | "ERROR";
        lastSyncAt: string | null;
        lastErrorCode: string | null;
        createdAt: string;
        updatedAt: string;
      }[];
    }>("/integrations/calendar/connections"),

  beginCalendarOAuth: (provider: "google" | "outlook") =>
    request<{ url: string; scopes: string[] }>(
      `/integrations/calendar/${provider}/authorize`,
    ),

  syncCalendar: (provider: "google" | "outlook") =>
    request<{
      synced: number;
      window: { timeMin: string; timeMax: string };
    }>(`/integrations/calendar/${provider}/sync`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  disconnectCalendar: (provider: "google" | "outlook") =>
    request<{ ok: true }>(`/integrations/calendar/${provider}`, {
      method: "DELETE",
    }),

  listCalendarEvents: (query?: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (query?.from) params.set("from", query.from);
    if (query?.to) params.set("to", query.to);
    const suffix = params.size ? `?${params}` : "";
    return request<{
      events: {
        id: string;
        provider: string;
        accountEmail: string | null;
        title: string;
        startsAt: string;
        endsAt: string;
        allDay: boolean;
        busy: boolean;
        syncedAt: string;
      }[];
    }>(`/integrations/calendar/events${suffix}`);
  },

  readCalendarEvent: (eventId: string) =>
    request<{
      id: string;
      provider: "google" | "outlook";
      title: string;
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      location: string;
      description: string;
      attendees: { name: string; email: string; status: string }[];
      truncated: boolean;
    }>(`/integrations/calendar/events/${encodeURIComponent(eventId)}`),

  deleteCalendarEvent: (
    provider: "google" | "outlook",
    eventId: string,
    proposalId: string,
  ) =>
    approveMailCalendarWrite({
      idempotencyKey: proposalId,
      action: "delete_event",
      provider,
      payload: { eventId },
    }).then((result) => ({ ok: true as const, replayed: result.replayed })),

  emailIntegrationStatus: () =>
    request<{
      providers: {
        gmail: {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
        "outlook-mail": {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
      };
      writesEnabled: boolean;
      privacy: {
        storesChatPlaintext: boolean;
        storesFullBodies: boolean;
        aiUsesMailBodiesByDefault: boolean;
        note: string;
      };
    }>("/integrations/email/status"),

  listEmailConnections: () =>
    request<{
      connections: {
        id: string;
        provider:
          | "GOOGLE_CALENDAR"
          | "OUTLOOK_CALENDAR"
          | "GMAIL"
          | "OUTLOOK_MAIL"
          | "GITHUB"
          | "LINEAR"
          | "SLACK";
        accountEmail: string | null;
        scopes: string[];
        status: "CONNECTED" | "REVOKED" | "ERROR";
        lastSyncAt: string | null;
        lastErrorCode: string | null;
      }[];
    }>("/integrations/email/connections"),

  beginEmailOAuth: (provider: "gmail" | "outlook-mail") =>
    request<{ url: string; scopes: string[] }>(
      `/integrations/email/${provider}/authorize`,
    ),

  syncEmail: (provider: "gmail" | "outlook-mail") =>
    request<{ synced: number }>(`/integrations/email/${provider}/sync`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  disconnectEmail: (provider: "gmail" | "outlook-mail") =>
    request<{ ok: true }>(`/integrations/email/${provider}`, {
      method: "DELETE",
    }),

  listEmailMessages: () =>
    request<{
      messages: {
        id: string;
        provider: string;
        accountEmail: string | null;
        subject: string;
        fromAddress: string;
        receivedAt: string;
        snippet: string;
        syncedAt: string;
      }[];
    }>("/integrations/email/messages"),

  readEmailMessage: (messageId: string) =>
    request<{ id: string; body: string; truncated: boolean }>(
      `/integrations/email/messages/${encodeURIComponent(messageId)}/body`,
    ),

  workIntegrationStatus: () =>
    request<{
      providers: {
        github: {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
        linear: {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
      };
      writesEnabled: boolean;
      privacy: {
        storesChatPlaintext: boolean;
        storesIssueBodies: boolean;
        aiUsesWorkBodiesByDefault: boolean;
        note: string;
      };
    }>("/integrations/work/status"),

  listWorkConnections: () =>
    request<{
      connections: {
        id: string;
        provider: "GITHUB" | "LINEAR";
        accountEmail: string | null;
        scopes: string[];
        status: "CONNECTED" | "REVOKED" | "ERROR";
        lastSyncAt: string | null;
        lastErrorCode: string | null;
      }[];
    }>("/integrations/work/connections"),

  beginWorkOAuth: (provider: "github" | "linear") =>
    request<{ url: string; scopes: string[] }>(
      `/integrations/work/${provider}/authorize`,
    ),

  syncWork: (provider: "github" | "linear") =>
    request<{ synced: number }>(`/integrations/work/${provider}/sync`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  disconnectWork: (provider: "github" | "linear") =>
    request<{ ok: true }>(`/integrations/work/${provider}`, {
      method: "DELETE",
    }),

  listWorkItems: () =>
    request<{
      items: {
        id: string;
        provider: string;
        accountEmail: string | null;
        kind: "ISSUE" | "PULL_REQUEST";
        number: number | null;
        title: string;
        state: string;
        url: string;
        containerKey: string;
        updatedAtExternal: string | null;
        syncedAt: string;
      }[];
    }>("/integrations/work/items"),

  collabIntegrationStatus: () =>
    request<{
      providers: {
        slack: {
          configured: boolean;
          scopes: string[];
          requiredWriteScopes: string[];
        };
      };
      writesEnabled: boolean;
      privacy: {
        storesChatPlaintext: boolean;
        storesMessageHistory: boolean;
        aiUsesCollabBodiesByDefault: boolean;
        note: string;
      };
    }>("/integrations/collab/status"),

  integrationWritesStatus: () =>
    request<{
      writesEnabled: boolean;
      note: string;
      requiredWriteScopes: Record<string, string[]>;
    }>("/integrations/writes/status"),

  createCalendarEvent: (
    provider: "google" | "outlook",
    body: {
      title: string;
      startsAt: string;
      endsAt: string;
      allDay?: boolean;
      description?: string;
    },
  ) =>
    request<{
      ok: true;
      externalEventId: string;
      htmlLink: string | null;
    }>(`/integrations/calendar/${provider}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateCalendarEvent: (
    provider: "google" | "outlook",
    externalEventId: string,
    body: {
      title: string;
      startsAt: string;
      endsAt: string;
      allDay?: boolean;
      description?: string;
    },
    proposalId: string,
  ) =>
    approveMailCalendarWrite({
      idempotencyKey: proposalId,
      action: "reschedule_event",
      provider,
      payload: { ...body, externalEventId },
    }).then((result) => ({
      ok: true as const,
      externalEventId: result.externalId ?? externalEventId,
      htmlLink: result.htmlLink,
      replayed: result.replayed,
    })),

  createEmailDraft: (
    provider: "gmail" | "outlook-mail",
    body: {
      to: string[];
      subject: string;
      body: string;
      cc?: string[];
      html?: string;
      contentType?: "text/plain" | "text/html";
      attachments?: OutboundEmailAttachment[];
    },
    proposalId: string,
  ) =>
    approveMailCalendarWrite({
      idempotencyKey: proposalId,
      action: "save_draft",
      provider,
      payload: body,
    }).then((result) => ({
      ok: true as const,
      externalDraftId: result.externalId ?? "",
      replayed: result.replayed,
    })),

  sendEmail: (
    provider: "gmail" | "outlook-mail",
    body: {
      to: string[];
      subject: string;
      body: string;
      cc?: string[];
      html?: string;
      contentType?: "text/plain" | "text/html";
      attachments?: OutboundEmailAttachment[];
    },
    proposalId: string,
  ) =>
    approveMailCalendarWrite({
      idempotencyKey: proposalId,
      action: "send_email",
      provider,
      payload: body,
    }).then((result) => ({
      ok: true as const,
      externalMessageId: result.externalId,
      replayed: result.replayed,
    })),

  createGitHubIssue: (body: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
  }) =>
    request<{
      ok: true;
      number: number;
      url: string;
      id: string;
    }>("/integrations/work/github/issues", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createLinearIssue: (body: {
    title: string;
    teamId: string;
    description?: string;
  }) =>
    request<{
      ok: true;
      id: string;
      identifier: string | null;
      url: string | null;
    }>("/integrations/work/linear/issues", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  postSlackMessage: (body: { channelId: string; text: string }) =>
    request<{
      ok: true;
      channelId: string;
      ts: string;
    }>("/integrations/collab/slack/messages", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateTask: (
    id: string,
    body: {
      title?: string;
      dueAt?: string | null;
      projectId?: string | null;
      status?: "OPEN" | "DONE" | "DISMISSED";
    },
  ) =>
    request<{
      task: {
        id: string;
        title: string;
        dueAt: string | null;
        status: "OPEN" | "DONE" | "DISMISSED";
        source: "MANUAL" | "RADAR";
        clientDraftId: string | null;
        conversationId: string | null;
        projectId: string | null;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listCollabConnections: () =>
    request<{
      connections: {
        id: string;
        provider: "SLACK";
        accountEmail: string | null;
        scopes: string[];
        status: "CONNECTED" | "REVOKED" | "ERROR";
        lastSyncAt: string | null;
        lastErrorCode: string | null;
      }[];
    }>("/integrations/collab/connections"),

  beginCollabOAuth: (provider: "slack") =>
    request<{ url: string; scopes: string[] }>(
      `/integrations/collab/${provider}/authorize`,
    ),

  syncCollab: (provider: "slack") =>
    request<{ synced: number }>(`/integrations/collab/${provider}/sync`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  disconnectCollab: (provider: "slack") =>
    request<{ ok: true }>(`/integrations/collab/${provider}`, {
      method: "DELETE",
    }),

  cloudSophiaConsent: () =>
    request<{
      active: boolean;
      purposeText: string;
      versionId: string;
      consent: {
        id: string;
        purposeText: string;
        versionId: string;
        grantedAt: string;
        withdrawnAt: string | null;
      } | null;
    }>("/sophia/cloud/consent"),

  grantCloudSophiaConsent: (body: {
    accepted: true;
    purposeText: string;
    versionId: string;
  }) =>
    request<{
      consent: {
        id: string;
        purposeText: string;
        versionId: string;
        grantedAt: string;
        withdrawnAt: string | null;
      };
    }>("/sophia/cloud/consent", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  withdrawCloudSophiaConsent: () =>
    request<{ ok: true; withdrawn: boolean }>("/sophia/cloud/consent/withdraw", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  completeCloudSophia: (body: { prompt: string }) =>
    request<{ reply: string }>("/sophia/cloud/complete", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listActivity: () =>
    request<{
      events: AccountActivityEvent[];
      truncated: boolean;
      recorded: string[];
      notRecorded: string[];
    }>("/account/activity"),

  exportActivity: () =>
    request<AccountActivityExport>("/account/activity/export"),

  deleteActivity: () =>
    request<{ ok: true; deleted: number }>("/account/activity", {
      method: "DELETE",
    }),

  recordActivity: (body: {
    action: "SETTING_CHANGED" | "BUTTON_ACTION";
    summary: string;
    subjectKind?: "setting" | "consent" | "email" | "calendar" | "button";
    subjectId?: string;
  }) =>
    request<{ event: AccountActivityEvent }>("/account/activity", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  dailyBrief: () => request<DailyBriefResponse>("/daily-brief"),

  generateDailyBrief: () =>
    request<DailyBriefResponse>("/daily-brief", { method: "POST" }),

  saveDailyBriefPreference: (body: {
    briefTime: string;
    language: "en" | "ar";
    timeZone: string;
  }) =>
    request<DailyBriefResponse>("/daily-brief/preferences", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  listWorkspaces: () =>
    request<{ workspaces: WorkspaceSummary[] }>("/workspaces"),

  createWorkspace: (body: { name: string; kind: "FAMILY" | "TEAM" }) =>
    request<{ workspace: WorkspaceSummary }>("/workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  workspaceDetail: (id: string) =>
    request<{
      workspace: WorkspaceSummary;
      members: WorkspaceMemberRow[];
      invites: WorkspaceInviteRow[];
    }>(`/workspaces/${encodeURIComponent(id)}`),

  workspaceMembers: (id: string, query?: string) =>
    request<{ members: WorkspaceMemberRow[] }>(
      `/workspaces/${encodeURIComponent(id)}/members${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),

  setWorkspaceRole: (id: string, userId: string, role: WorkspaceRole) =>
    request<{ ok: true }>(`/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  removeWorkspaceMember: (id: string, userId: string) =>
    request<{ ok: true }>(`/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),

  createWorkspaceInvite: (id: string, expiresInHours?: number) =>
    request<{ invite: { id: string; code: string; hint: string; expiresAt: string; path: string } }>(
      `/workspaces/${encodeURIComponent(id)}/invites`,
      {
        method: "POST",
        body: JSON.stringify(expiresInHours ? { expiresInHours } : {}),
      },
    ),

  revokeWorkspaceInvite: (id: string, inviteId: string) =>
    request<{ ok: true }>(`/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, {
      method: "DELETE",
    }),

  previewWorkspaceInvite: (code: string) =>
    request<{ workspace: { name: string; kind: "FAMILY" | "TEAM" } }>(
      `/workspace-invites/preview?code=${encodeURIComponent(code)}`,
    ),

  redeemWorkspaceInvite: (code: string) =>
    request<{ workspace: WorkspaceSummary }>("/workspace-invites/redeem", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  workspaceDirect: (id: string, username: string) =>
    request<Conversation>(`/workspaces/${encodeURIComponent(id)}/conversations/direct`, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),

  workspaceGroup: (id: string, body: { title?: string; memberUserIds: string[] }) =>
    request<Conversation>(`/workspaces/${encodeURIComponent(id)}/conversations/group`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  checkoutWorkspace: (id: string, body: { planId: "FREE_FAMILY" | "FAMILY_PLUS" | "TEAM"; seatQuantity?: number }) =>
    request<{ ok: true; status: string; checkoutUrl: string | null }>(
      `/workspaces/${encodeURIComponent(id)}/billing/checkout`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  confirmPayPalCheckout: (id: string, subscriptionId: string) =>
    request<{ ok: true; status: string; granted: boolean; planId: string | null }>(
      `/workspaces/${encodeURIComponent(id)}/billing/paypal/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ subscriptionId }),
      },
    ),

  joinDesignPartnerWaitlist: (body: { email: string; locale?: "en" | "ar"; note?: string }) =>
    request<{ ok: true }>("/waitlist", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  renameConversation: (id: string, title: string) =>
    request<{ ok: true; title: string; previousTitle: string | null }>(
      `/conversations/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    ),

  agentStatus: () =>
    request<{
      enabled: boolean;
      autonomy: "full_control" | "ask_first";
      readChats: boolean;
      readChatsPurpose: string;
      readChatsVersion: string;
      halted: boolean;
      model: "mock" | "real";
      experimentalUntil: number;
    }>("/sophia/agent"),

  saveAgentSettings: (body: { autonomy: "full_control" | "ask_first"; readChats: boolean }) =>
    request<{
      autonomy: "full_control" | "ask_first";
      readChats: boolean;
      halted: boolean;
    }>("/sophia/agent/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  stopAgent: () =>
    request<{ halted: boolean }>("/sophia/agent/stop", { method: "POST" }),

  resumeAgent: () =>
    request<{ halted: boolean }>("/sophia/agent/resume", { method: "POST" }),

  recordAgentActivity: (body: { tool: string; result: string; summary: string }) =>
    request<{ ok: true }>("/sophia/agent/activity", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listCollabChannels: () =>
    request<{
      channels: {
        id: string;
        provider: string;
        accountEmail: string | null;
        name: string;
        isPrivate: boolean;
        isArchived: boolean;
        syncedAt: string;
      }[];
    }>("/integrations/collab/channels"),
};

export function wsUrl() {
  const url = new URL(API_URL);

  url.protocol =
    url.protocol === "https:"
      ? "wss:"
      : "ws:";

  url.pathname = "/ws";

  return url.toString();
}