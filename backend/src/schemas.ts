import { z } from "zod";
import {
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
} from "./cloud-sophia-policy.js";
import { passwordPolicyFailure } from "./password-policy.js";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/)
    .trim()
    .toLowerCase(),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().max(128),
  passwordConfirm: z.string().min(1),
  displayName: z.string().trim().min(1).max(80).optional(),
  cloudSophiaConsent: z.object({
    accepted: z.literal(true),
    purposeText: z.literal(CLOUD_SOPHIA_PURPOSE),
    versionId: z.literal(CLOUD_SOPHIA_CONSENT_VERSION),
  }).strict().optional(),
}).refine(
  ({ password, passwordConfirm }) =>
    password === passwordConfirm,
  {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  },
).refine(
  ({ password, email }) => passwordPolicyFailure(password, email) === null,
  {
    message: "Password does not meet the strength rules.",
    path: ["password"],
  },
);

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
  code: z.string().trim().min(1).max(32).optional(),
  trustBrowser: z.boolean().optional().default(false),
});

export const confirmTotpSchema = z.object({
  setupToken: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/),
  trustBrowser: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().max(128),
  passwordConfirm: z.string().min(1),
  code: z.string().trim().min(1).max(32),
}).refine(
  ({ password, passwordConfirm }) =>
    password === passwordConfirm,
  {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  },
).refine(
  ({ password }) => passwordPolicyFailure(password) === null,
  {
    message: "Password does not meet the strength rules.",
    path: ["password"],
  },
);

export const authTokenSchema = z.object({
  token: z.string().min(1),
});

export const registerDeviceSchema = z.object({
  deviceName: z.string().min(1).max(80),
  identityPublicKey: z.string().min(1),
  signingPublicKey: z.string().min(1),
  signedPreKeyId: z.number().int().nonnegative(),
  signedPreKey: z.string().min(1),
  signedPreKeySig: z.string().min(1),
  oneTimePreKeys: z
    .array(
      z.object({
        keyId: z.number().int().nonnegative(),
        publicKey: z.string().min(1),
      }),
    )
    .max(200),
});

export const deviceVaultBackupSchema = z.object({
  vault: z.object({
    userId: z.string().uuid().optional(),
    version: z.number().int().positive(),
    salt: z.string().min(16).max(64),
    nonce: z.string().min(16).max(32),
    ciphertext: z.string().min(32).max(64 * 1024),
  }).strict(),
}).strict();

const encryptedDeviceBackupSchema = z.object({
  recordId: z.string().trim().min(1).max(512),
  conversationId: z.string().uuid().optional(),
  createdAt: z.string().datetime().optional(),
  nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.string().min(1).max(512 * 1024),
}).strict();

export const saveDeviceBackupsSchema = z.object({
  records: z.array(encryptedDeviceBackupSchema).min(1).max(100),
}).strict().refine(
  (value) => new Set(value.records.map((record) => record.recordId)).size === value.records.length,
  "Backup record IDs must be unique within a batch.",
).refine(
  (value) => value.records.reduce((total, record) => total + record.ciphertext.length, 0) <= 850 * 1024,
  "Backup batch is too large.",
);

export const listDeviceBackupsQuery = z.object({
  kind: z.enum(["message", "session"]),
  after: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();

const base64KeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const encryptedArchiveKeySchema = z.object({
  publicKey: base64KeySchema,
  passwordSalt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  passwordNonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  passwordEncryptedPrivateKey: z.string().min(32).max(8 * 1024),
  recoverySalt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  recoveryNonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  recoveryEncryptedPrivateKey: z.string().min(32).max(8 * 1024),
}).strict();

export const createAccountArchiveKeySchema = z.object({
  key: encryptedArchiveKeySchema.extend({
    recoveryCodeHash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  }),
}).strict();

export const rewrapAccountArchiveKeySchema = z.object({
  recoveryCodeHash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  passwordSalt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  passwordNonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  passwordEncryptedPrivateKey: z.string().min(32).max(8 * 1024),
}).strict();

const archiveEnvelopeSchema = z.object({
  ownerUserId: z.string().uuid(),
  recipientPublicKey: base64KeySchema,
  ephemeralPublicKey: base64KeySchema,
  nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.string().min(24).max(128 * 1024),
}).strict();

const archiveMessageSchema = z.object({
  logicalMessageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  senderDeviceId: z.string().uuid(),
  ephemeralPublicKey: base64KeySchema,
  nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.string().min(24).max(128 * 1024),
  createdAt: z.string().datetime(),
}).strict();

export const saveAccountArchiveMessagesSchema = z.object({
  records: z.array(archiveMessageSchema).min(1).max(100),
}).strict()
  .refine(
    (value) => new Set(value.records.map((record) => record.logicalMessageId)).size === value.records.length,
    "Archive message IDs must be unique within a batch.",
  )
  .refine(
    (value) => value.records.reduce((total, record) => total + record.ciphertext.length, 0) <= 850 * 1024,
    "Archive message batch is too large.",
  );

export const listAccountArchiveMessagesQuery = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();

export const replenishPreKeysSchema = z.object({
  oneTimePreKeys: z
    .array(
      z.object({
        keyId: z.number().int().nonnegative(),
        publicKey: z.string().min(1),
      }),
    )
    .min(1)
    .max(200),
});

export const createDirectSchema = z.object({
  username: z.string().min(3).max(24),
});

const groupUsernameSchema = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).toLowerCase();

export const createGroupSchema = z.object({
  memberUserIds: z.array(z.string().uuid()).max(8).optional(),
  memberUsernames: z.array(groupUsernameSchema).max(8).optional(),
  title: z.string().trim().min(1).max(80).optional(),
}).strict();

export const addGroupMemberSchema = z.object({
  userId: z.string().uuid().optional(),
  username: groupUsernameSchema.optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
}).strict().refine((body) => Boolean(body.userId) !== Boolean(body.username), {
  message: "Provide a user id or a username",
});

export const renameGroupSchema = z.object({
  title: z.string().trim().min(1).max(80),
}).strict();

export const setGroupRoleSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]),
}).strict();

export const markGroupReadSchema = z.object({
  blobId: z.string().uuid().optional(),
}).strict();

export const postGroupMlsBlobSchema = z.object({
  senderDeviceId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  kind: z.enum(["key_package", "welcome", "commit", "proposal", "application"]),
  payload: z.string().min(1).max(350_000),
  recipientDeviceId: z.string().uuid().optional(),
  bindingSignature: z.string().min(1).max(128).optional(),
}).strict();

export const listGroupMlsQuery = z.object({
  deviceId: z.string().uuid(),
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const updateProfileSchema = z.object({
  interests: z.array(
    z.string().trim().min(1).max(40).transform((interest) =>
      interest.toLocaleLowerCase("en-US"),
    ),
  ).max(20).transform((interests) => [...new Set(interests)]),
});

const messageEnvelopeSchema = z
  .object({
    recipientDeviceId: z.string().uuid(),
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    ratchetHeader: z
      .object({
        recipientDeviceId: z.string().uuid(),
      })
      .passthrough(),
  })
  .refine(
    (envelope) =>
      envelope.ratchetHeader.recipientDeviceId === envelope.recipientDeviceId,
    "Envelope recipient must match its encrypted header",
  );

export const sendMessageSchema = z.union([
  z.object({
    senderDeviceId: z.string().uuid(),
    envelopes: z.array(messageEnvelopeSchema).min(1).max(200).refine(
      (envelopes) =>
        new Set(envelopes.map((envelope) => envelope.recipientDeviceId)).size ===
        envelopes.length,
      "Each recipient device must have exactly one envelope",
    ),
    logicalMessageId: z.string().uuid().optional(),
    archiveEnvelopes: z.array(archiveEnvelopeSchema).min(2).max(200).refine(
      (envelopes) =>
        new Set(envelopes.map((envelope) => envelope.ownerUserId)).size === envelopes.length,
      "Each account must have exactly one archive envelope",
    ).optional(),
  }).strict().refine(
    (value) => (value.archiveEnvelopes?.reduce((total, envelope) => total + envelope.ciphertext.length, 0) ?? 0) <= 850 * 1024,
    "Archive message batch is too large.",
  ),
  z.object({
    senderDeviceId: z.string().uuid(),
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    ratchetHeader: z.unknown(),
  }).strict(),
]);

export const listMessagesQuery = z.object({
  after: z.string().uuid().optional(),
  fromStart: z.literal("true").optional(),
  before: z.string().datetime().optional(),
  beforeId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine(
  ({ after, fromStart, before, beforeId }) =>
    !(after && before) &&
    !(fromStart && (after || before)) &&
    Boolean(before) === Boolean(beforeId),
  "Use either after or a before timestamp and message ID",
);

export const listMessageDeletionsQuery = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();

export const deleteMessageSchema = z.object({
  logicalMessageId: z.string().uuid(),
}).strict();

export const recipientDevicesQuery = z.object({
  senderDeviceId: z.string().uuid(),
});

export const prekeyBundleQuery = z.object({
  deviceId: z.string().uuid().optional(),
});

export const researchSearchSchema = z.object({
  query: z.string().trim().min(1).max(300),
});

export const urlSafetyCheckSchema = z.object({
  urls: z.array(z.string().trim().min(1).max(2_048)).min(1).max(500),
}).strict().refine(
  (value) => value.urls.reduce((total, url) => total + url.length, 0) <= 128 * 1024,
  "URL check request is too large.",
);

const callDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(64 * 1024),
}).strict();

export const callSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call:invite"),
    callId: z.string().uuid(),
    conversationId: z.string().uuid(),
    mode: z.enum(["audio", "video"]),
    offer: callDescriptionSchema.extend({ type: z.literal("offer") }),
  }).strict(),
  z.object({
    type: z.literal("call:answer"),
    callId: z.string().uuid(),
    conversationId: z.string().uuid(),
    answer: callDescriptionSchema.extend({ type: z.literal("answer") }),
  }).strict(),
  z.object({
    type: z.literal("call:ice"),
    callId: z.string().uuid(),
    conversationId: z.string().uuid(),
    candidate: z.object({
      candidate: z.string().min(1).max(4_096),
      sdpMid: z.string().max(256).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.enum(["call:reject", "call:end"]),
    callId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }).strict(),
]);

export const maxEncryptedFileBytes = 450_000_000 + 16;
export const maxEncryptedMediaBytes = 6_500_000;
export const maxEncryptedPhotoBytes = maxEncryptedMediaBytes;

export const createMediaUploadSchema = z.object({
  kind: z.enum(["photo", "video", "voice", "file"]),
  byteSize: z.number().int().min(1).max(maxEncryptedFileBytes),
}).refine(
  (value) => value.kind === "file" || value.byteSize <= maxEncryptedMediaBytes,
  "Photo, video, and voice attachments are limited to 6.5 MB encrypted.",
);

export const mediaIdParamSchema = z.object({
  mediaId: z.string().uuid(),
});

const optionalIsoDateTime = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  dueAt: optionalIsoDateTime,
  projectId: z.string().uuid().optional(),
  source: z.enum(["MANUAL", "RADAR"]).optional().default("MANUAL"),
  clientDraftId: z.string().trim().min(1).max(80).optional(),
  conversationId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "DONE", "DISMISSED"]).optional().default("OPEN"),
}).strict();

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  dueAt: optionalIsoDateTime.nullable(),
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(["OPEN", "DONE", "DISMISSED"]).optional(),
}).strict().refine(
  (value) =>
    value.title !== undefined ||
    value.dueAt !== undefined ||
    value.projectId !== undefined ||
    value.status !== undefined,
  "At least one field is required",
);

export const createReminderSchema = z.object({
  remindAt: z
    .string()
    .trim()
    .max(40)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
  taskId: z.string().uuid().optional(),
}).strict();

export const updateReminderSchema = z.object({
  remindAt: z
    .string()
    .trim()
    .max(40)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
    .optional(),
  status: z.enum(["SCHEDULED", "CANCELLED", "FIRED"]).optional(),
}).strict().refine(
  (value) => value.remindAt !== undefined || value.status !== undefined,
  "At least one field is required",
);

export const cloudSophiaConsentSchema = z.object({
  accepted: z.literal(true),
  purposeText: z.literal(CLOUD_SOPHIA_PURPOSE),
  versionId: z.literal(CLOUD_SOPHIA_CONSENT_VERSION),
}).strict();

export const recordActivitySchema = z.object({
  action: z.enum(["SETTING_CHANGED", "BUTTON_ACTION"]),
  summary: z.string().trim().min(1).max(160),
  subjectKind: z.enum(["setting", "consent", "email", "calendar", "button"]).optional(),
  subjectId: z.string().trim().min(1).max(80).optional(),
}).strict();

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["FAMILY", "TEAM"]),
}).strict();

export const createWorkspaceInviteSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 14).optional(),
}).strict();

export const redeemWorkspaceInviteSchema = z.object({
  code: z.string().trim().min(8).max(32),
}).strict();

export const previewWorkspaceInviteQuery = z.object({
  code: z.string().trim().min(8).max(64),
}).strict();

export const updateWorkspaceRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
}).strict();

export const workspaceDirectoryQuery = z.object({
  q: z.string().trim().max(40).optional(),
}).strict();

export const userLookupQuery = z.object({
  q: z.string().trim().min(2).max(80),
}).strict();

export const workspaceDirectSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).toLowerCase(),
}).strict();

export const workspaceGroupSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  memberUserIds: z.array(z.string().uuid()).max(8).default([]),
}).strict();

export const workspaceCheckoutSchema = z.object({
  planId: z.enum(["FREE_FAMILY", "FAMILY_PLUS", "TEAM"]),
  seatQuantity: z.number().int().min(1).max(50).optional(),
}).strict();

export const paypalConfirmSchema = z.object({
  subscriptionId: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9-]+$/),
}).strict();

export const designPartnerSchema = z.object({
  email: z.string().trim().email().max(200),
  locale: z.enum(["en", "ar"]).optional(),
  note: z.string().trim().max(280).optional(),
}).strict();

export const createAiConsentSchema = z.object({
  scope: z.enum(["CLOUD_AI", "CONVERSATION_ANALYSIS"]),
  conversationId: z.string().uuid().optional(),
  evidenceVersion: z.number().int().min(1).max(100).optional().default(1),
}).strict();
