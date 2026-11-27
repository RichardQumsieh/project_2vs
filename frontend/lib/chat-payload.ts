import { z } from "zod";

export const imagePayloadPrefix = "PM1IMG:";
export const videoPayloadPrefix = "PM1VID:";
export const voicePayloadPrefix = "PM1AUD:";
export const maxEncryptedVoiceNoteBytes = 6_500_000;
export const filePayloadPrefix = "PM1FIL:";
export const locationPayloadPrefix = "PM1LOC:";
export const albumPayloadPrefix = "PM1ALB:";
export const replyPayloadPrefix = "PM1RPL:";
export const callPayloadPrefix = "PM1CALL:";
export const maxAlbumPhotos = 10;
export const maxReplyRefs = 8;
export const maxFileAttachmentBytes = 450_000_000;
export const maxEncryptedFileAttachmentBytes = maxFileAttachmentBytes + 16;
export const allowedFileAttachmentTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

const safeAttachmentNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,250}\.[a-zA-Z0-9]{1,10}$/u;
const imagePayloadSchema = z.object({
  id: z.string().uuid(),
  k: z.string().length(44),
  n: z.string().length(16),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  w: z.number().int().positive().max(12_000).optional(),
  h: z.number().int().positive().max(12_000).optional(),
  bytes: z.number().int().min(17).max(6_500_000),
  caption: z.string().max(4000).optional(),
});

const videoPayloadSchema = z.object({
  id: z.string().uuid(),
  k: z.string().length(44),
  n: z.string().length(16),
  mime: z.enum(["video/webm", "video/mp4"]),
  duration: z.number().positive().max(75),
  bytes: z.number().int().min(17).max(6_500_000),
  caption: z.string().max(4000).optional(),
});

const voicePayloadSchema = z.object({
  id: z.string().uuid(),
  k: z.string().length(44),
  n: z.string().length(16),
  mime: z.enum(["audio/webm", "audio/ogg", "audio/mp4"]),
  duration: z.number().positive(),
  bytes: z.number().int().min(17).max(maxEncryptedVoiceNoteBytes),
  wave: z.array(z.number().min(0).max(1)).max(48).optional(),
  caption: z.string().max(4000).optional(),
});

const filePayloadSchema = z.object({
  id: z.string().uuid(),
  k: z.string().length(44),
  n: z.string().length(16),
  name: z.string().min(1).max(255).regex(safeAttachmentNamePattern),
  mime: z.enum(allowedFileAttachmentTypes),
  bytes: z.number().int().min(17).max(maxEncryptedFileAttachmentBytes),
  containsExternalLinks: z.boolean(),
  caption: z.string().max(4000).optional(),
}).refine(
  ({ name, mime }) =>
    Object.entries({
      csv: "text/csv",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }).some(([extension, expectedMime]) =>
      name.toLowerCase().endsWith(`.${extension}`) && mime === expectedMime,
    ),
  "Attachment name and type do not match.",
);

const locationPayloadSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(100_000).optional(),
  altitude: z.number().finite().min(-12_000).max(100_000).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  caption: z.string().max(4000).optional(),
  sharedAt: z.string().datetime({ offset: true }).max(64),
});

const albumItemSchema = imagePayloadSchema.omit({ caption: true });

const albumPayloadSchema = z.object({
  items: z.array(albumItemSchema).min(1).max(maxAlbumPhotos),
  caption: z.string().max(4000).optional(),
});

const replyRefSchema = z.object({
  id: z.string().min(1).max(120),
  preview: z.string().min(1).max(280),
  fromMe: z.boolean(),
});

const replyPayloadSchema = z.object({
  refs: z.array(replyRefSchema).min(1).max(maxReplyRefs),
  body: z.string().min(1).max(4000),
});

const callPayloadSchema = z.object({
  callId: z.string().uuid(),
  mode: z.enum(["audio", "video"]),
  outcome: z.enum(["completed", "missed", "declined", "cancelled"]),
  durationSeconds: z.number().min(0).max(24 * 60 * 60),
  at: z.string().datetime({ offset: true }).max(64),
});

export type ImageChatPayload = z.infer<typeof imagePayloadSchema> & {
  type: "image";
};

export type VideoChatPayload = z.infer<typeof videoPayloadSchema> & {
  type: "video";
};

export type VoiceChatPayload = z.infer<typeof voicePayloadSchema> & {
  type: "voice";
};

export type FileChatPayload = z.infer<typeof filePayloadSchema> & {
  type: "file";
};

export type LocationChatPayload = z.infer<typeof locationPayloadSchema> & {
  type: "location";
};

export type AlbumChatPayload = z.infer<typeof albumPayloadSchema> & {
  type: "album";
};

export type ReplyChatPayload = z.infer<typeof replyPayloadSchema> & {
  type: "reply";
};

export type CallChatPayload = z.infer<typeof callPayloadSchema> & {
  type: "call";
};

export type ChatPayload =
  | { type: "text"; text: string }
  | ImageChatPayload
  | VideoChatPayload
  | VoiceChatPayload
  | FileChatPayload
  | LocationChatPayload
  | AlbumChatPayload
  | ReplyChatPayload
  | CallChatPayload;

export function callLogLabel(payload: Omit<CallChatPayload, "type" | "callId" | "at">) {
  const kind = payload.mode === "video" ? "video call" : "voice call";
  if (payload.outcome === "missed") return `Missed ${kind}`;
  if (payload.outcome === "declined") return `Declined ${kind}`;
  if (payload.outcome === "cancelled") return `Cancelled ${kind}`;
  const total = Math.max(0, Math.round(payload.durationSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const title = payload.mode === "video" ? "Video call" : "Voice call";
  return `${title} · ${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function encodeImagePayload(
  payload: Omit<ImageChatPayload, "type">,
) {
  return `${imagePayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeVideoPayload(
  payload: Omit<VideoChatPayload, "type">,
) {
  return `${videoPayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeVoicePayload(
  payload: Omit<VoiceChatPayload, "type">,
) {
  return `${voicePayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeFilePayload(
  payload: Omit<FileChatPayload, "type">,
) {
  return `${filePayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeLocationPayload(
  payload: Omit<LocationChatPayload, "type">,
) {
  return `${locationPayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeAlbumPayload(
  payload: Omit<AlbumChatPayload, "type">,
) {
  return `${albumPayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeReplyPayload(
  payload: Omit<ReplyChatPayload, "type">,
) {
  return `${replyPayloadPrefix}${JSON.stringify(payload)}`;
}

export function encodeCallPayload(
  payload: Omit<CallChatPayload, "type">,
) {
  return `${callPayloadPrefix}${JSON.stringify(payload)}`;
}

export function parseChatPayload(plaintext: string): ChatPayload {
  if (
    !plaintext.startsWith(imagePayloadPrefix) &&
    !plaintext.startsWith(videoPayloadPrefix) &&
    !plaintext.startsWith(voicePayloadPrefix) &&
    !plaintext.startsWith(filePayloadPrefix) &&
    !plaintext.startsWith(locationPayloadPrefix) &&
    !plaintext.startsWith(albumPayloadPrefix) &&
    !plaintext.startsWith(replyPayloadPrefix) &&
    !plaintext.startsWith(callPayloadPrefix)
  ) {
    return { type: "text", text: plaintext };
  }

  try {
    if (plaintext.startsWith(imagePayloadPrefix)) {
      const parsed = imagePayloadSchema.parse(
        JSON.parse(plaintext.slice(imagePayloadPrefix.length)),
      );
      return { type: "image", ...parsed };
    }

    if (plaintext.startsWith(videoPayloadPrefix)) {
      const parsed = videoPayloadSchema.parse(
        JSON.parse(plaintext.slice(videoPayloadPrefix.length)),
      );
      return { type: "video", ...parsed };
    }

    if (plaintext.startsWith(voicePayloadPrefix)) {
      const parsed = voicePayloadSchema.parse(
        JSON.parse(plaintext.slice(voicePayloadPrefix.length)),
      );
      return { type: "voice", ...parsed };
    }

    if (plaintext.startsWith(locationPayloadPrefix)) {
      const parsed = locationPayloadSchema.parse(
        JSON.parse(plaintext.slice(locationPayloadPrefix.length)),
      );
      return { type: "location", ...parsed };
    }

    if (plaintext.startsWith(albumPayloadPrefix)) {
      const parsed = albumPayloadSchema.parse(
        JSON.parse(plaintext.slice(albumPayloadPrefix.length)),
      );
      return { type: "album", ...parsed };
    }

    if (plaintext.startsWith(replyPayloadPrefix)) {
      const parsed = replyPayloadSchema.parse(
        JSON.parse(plaintext.slice(replyPayloadPrefix.length)),
      );
      return { type: "reply", ...parsed };
    }

    if (plaintext.startsWith(callPayloadPrefix)) {
      const parsed = callPayloadSchema.parse(
        JSON.parse(plaintext.slice(callPayloadPrefix.length)),
      );
      return { type: "call", ...parsed };
    }

    const parsed = filePayloadSchema.parse(
      JSON.parse(plaintext.slice(filePayloadPrefix.length)),
    );
    return { type: "file", ...parsed };
  } catch {
    return { type: "text", text: "" };
  }
}

export function messagePreviewText(plaintext: string) {
  const payload = parseChatPayload(plaintext);
  switch (payload.type) {
    case "text":
      return payload.text.trim().slice(0, 280) || "Message";
    case "reply":
      return payload.body.trim().slice(0, 280) || "Reply";
    case "image":
      return payload.caption?.trim() || "Photo";
    case "album":
      return (
        payload.caption?.trim() ||
        `${payload.items.length} photo${payload.items.length === 1 ? "" : "s"}`
      );
    case "video":
      return payload.caption?.trim() || "Video";
    case "voice":
      return payload.caption?.trim() || "Voice note";
    case "location":
      return payload.name?.trim() || "Shared location";
    case "file":
      return payload.caption?.trim() || payload.name || "File attachment";
    case "call":
      return callLogLabel(payload);
  }
}

export function assistantVisibleText(plaintext: string) {
  const payload = parseChatPayload(plaintext);
  if (payload.type === "reply") {
    return payload.body;
  }
  if (payload.type === "call") {
    return callLogLabel(payload);
  }
  if (
    payload.type === "image" ||
    payload.type === "album" ||
    payload.type === "video" ||
    payload.type === "voice" ||
    payload.type === "file" ||
    payload.type === "location"
  ) {
    const caption =
      payload.type === "album" ||
      payload.type === "image" ||
      payload.type === "video" ||
      payload.type === "voice" ||
      payload.type === "file" ||
      payload.type === "location"
        ? payload.caption?.trim()
        : undefined;
    if (caption) return caption;
    if (payload.type === "image") return "Photo";
    if (payload.type === "album") {
      return `${payload.items.length} photos`;
    }
    if (payload.type === "video") return "Video";
    if (payload.type === "voice") return "Voice note";
    if (payload.type === "location") {
      return payload.name?.trim() || "Shared location";
    }
    return "File attachment";
  }
  if (
    plaintext.startsWith(imagePayloadPrefix) ||
    plaintext.startsWith(videoPayloadPrefix) ||
    plaintext.startsWith(voicePayloadPrefix) ||
    plaintext.startsWith(filePayloadPrefix) ||
    plaintext.startsWith(locationPayloadPrefix) ||
    plaintext.startsWith(albumPayloadPrefix) ||
    plaintext.startsWith(replyPayloadPrefix) ||
    plaintext.startsWith(callPayloadPrefix)
  ) {
    return "";
  }
  return plaintext;
}

export function localMessageForAssistant<T extends { plaintext: string }>(
  message: T,
): T {
  return {
    ...message,
    plaintext: assistantVisibleText(message.plaintext),
  };
}
