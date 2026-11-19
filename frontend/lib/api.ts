import { resolveApiUrl } from "./api-url";
import { assertGroupE2eeEnabled } from "./group-e2ee-flag";
import type { OutboundEmailAttachment } from "./email-attachments";

const API_URL = resolveApiUrl();

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
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

    throw new ApiError(
      message,
      response.status,
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

  deleteCalendarEvent: (provider: "google" | "outlook", eventId: string) =>
    request<{ ok: true }>(
      `/integrations/calendar/${provider}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    ),

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
  ) =>
    request<{
      ok: true;
      externalEventId: string;
      htmlLink: string | null;
    }>(
      `/integrations/calendar/${provider}/events/${encodeURIComponent(externalEventId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

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
  ) =>
    request<{
      ok: true;
      externalDraftId: string;
    }>(`/integrations/email/${provider}/drafts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

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
  ) =>
    request<{
      ok: true;
      externalMessageId: string | null;
    }>(`/integrations/email/${provider}/send`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

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