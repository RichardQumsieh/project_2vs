import { describe, expect, it } from "vitest";
import {
  assistantVisibleText,
  encodeAlbumPayload,
  encodeImagePayload,
  encodeCallPayload,
  encodeReplyPayload,
  encodeVideoPayload,
  encodeVoicePayload,
  encodeFilePayload,
  encodeLocationPayload,
  maxEncryptedFileAttachmentBytes,
  messagePreviewText,
  parseChatPayload,
} from "./chat-payload";

const imagePayload = {
  id: "11111111-1111-4111-8111-111111111111",
  k: "A".repeat(44),
  n: "A".repeat(16),
  mime: "image/jpeg" as const,
  bytes: 28,
  caption: "sunset",
};

const videoPayload = {
  id: "22222222-2222-4222-8222-222222222222",
  k: "A".repeat(44),
  n: "A".repeat(16),
  mime: "video/webm" as const,
  duration: 74.5,
  bytes: 2048,
  caption: "A short clip",
};

const voicePayload = {
  id: "33333333-3333-4333-8333-333333333333",
  k: "A".repeat(44),
  n: "A".repeat(16),
  mime: "audio/webm" as const,
  duration: 12.5,
  bytes: 2048,
  caption: "Meet me after work.",
};

const filePayload = {
  id: "44444444-4444-4444-8444-444444444444",
  k: "A".repeat(44),
  n: "A".repeat(16),
  name: "presentation.pptx",
  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const,
  bytes: 2048,
  containsExternalLinks: true,
};

describe("chat payloads", () => {
  it("keeps ordinary text unchanged", () => {
    expect(parseChatPayload("hello")).toEqual({ type: "text", text: "hello" });
    expect(assistantVisibleText("hello")).toBe("hello");
  });

  it("round-trips an image payload without exposing keys to the assistant", () => {
    const encoded = encodeImagePayload(imagePayload);
    expect(parseChatPayload(encoded)).toEqual({ type: "image", ...imagePayload });
    expect(assistantVisibleText(encoded)).toBe("sunset");
  });

  it("round-trips a bounded video payload without exposing keys to the assistant", () => {
    const encoded = encodeVideoPayload(videoPayload);
    expect(parseChatPayload(encoded)).toEqual({ type: "video", ...videoPayload });
    expect(assistantVisibleText(encoded)).toBe("A short clip");
    expect(assistantVisibleText(encodeVideoPayload({
      ...videoPayload,
      caption: undefined,
    }))).toBe("Video");
  });

  it("rejects video metadata longer than 75 seconds or above the storage limit", () => {
    for (const invalidPayload of [
      { ...videoPayload, duration: 75.1 },
      { ...videoPayload, bytes: 6_500_001 },
    ]) {
      const encoded = encodeVideoPayload(invalidPayload);
      expect(parseChatPayload(encoded)).toEqual({ type: "text", text: "" });
      expect(assistantVisibleText(encoded)).toBe("");
    }
  });

  it("round-trips an encrypted voice-note payload and exposes only its caption", () => {
    const encoded = encodeVoicePayload(voicePayload);
    expect(parseChatPayload(encoded)).toEqual({ type: "voice", ...voicePayload });
    expect(assistantVisibleText(encoded)).toBe("Meet me after work.");
    expect(assistantVisibleText(encodeVoicePayload({
      ...voicePayload,
      caption: undefined,
    }))).toBe("Voice note");
  });

  it("rejects invalid voice-note metadata without exposing its key", () => {
    for (const invalidPayload of [
      { ...voicePayload, mime: "audio/wav" },
      { ...voicePayload, duration: 0 },
      { ...voicePayload, bytes: 6_500_001 },
    ]) {
      const encoded = encodeVoicePayload(invalidPayload as typeof voicePayload);
      expect(parseChatPayload(encoded)).toEqual({ type: "text", text: "" });
      expect(assistantVisibleText(encoded)).toBe("");
    }
  });

  it("round-trips an encrypted document payload without exposing attachment metadata to assistants", () => {
    const encoded = encodeFilePayload(filePayload);
    expect(parseChatPayload(encoded)).toEqual({ type: "file", ...filePayload });
    expect(assistantVisibleText(encoded)).toBe("File attachment");
    expect(assistantVisibleText(encodeFilePayload({
      ...filePayload,
      caption: "Here is the slide deck.",
    }))).toBe("Here is the slide deck.");
  });

  it("rejects unsafe names, unsupported formats, and files over 450 MiB", () => {
    for (const invalidPayload of [
      { ...filePayload, name: "deck.pptx.exe" },
      { ...filePayload, name: "../deck.pptx" },
      { ...filePayload, mime: "application/zip" },
      { ...filePayload, bytes: maxEncryptedFileAttachmentBytes + 1 },
    ]) {
      expect(parseChatPayload(encodeFilePayload(
        invalidPayload as typeof filePayload,
      ))).toEqual({ type: "text", text: "" });
      expect(assistantVisibleText(encodeFilePayload(
        invalidPayload as typeof filePayload,
      ))).toBe("");
    }
  });

  it("round-trips an encrypted location payload without exposing coordinates to assistants", () => {
    const locationPayload = {
      lat: 31.9539,
      lon: 35.9106,
      accuracy: 18,
      sharedAt: "2026-11-14T12:00:00.000Z",
      caption: "Meet here",
    };
    const encoded = encodeLocationPayload(locationPayload);
    expect(encoded.startsWith("PM1LOC:")).toBe(true);
    expect(parseChatPayload(encoded)).toEqual({
      type: "location",
      ...locationPayload,
    });
    expect(assistantVisibleText(encoded)).toBe("Meet here");
    expect(
      assistantVisibleText(
        encodeLocationPayload({
          ...locationPayload,
          caption: undefined,
          name: "Office",
        }),
      ),
    ).toBe("Office");
    expect(
      assistantVisibleText(
        encodeLocationPayload({
          ...locationPayload,
          caption: undefined,
          name: undefined,
        }),
      ),
    ).toBe("Shared location");
  });

  it("rejects invalid location metadata without treating it as readable text", () => {
    for (const invalidPayload of [
      { lat: 91, lon: 35, sharedAt: "2026-11-14T12:00:00.000Z" },
      { lat: 31, lon: 181, sharedAt: "2026-11-14T12:00:00.000Z" },
      { lat: 31, lon: 35, sharedAt: "not-a-date" },
    ]) {
      const encoded = encodeLocationPayload(invalidPayload as never);
      expect(parseChatPayload(encoded)).toEqual({ type: "text", text: "" });
      expect(assistantVisibleText(encoded)).toBe("");
    }
  });

  it("does not treat a broken image payload as readable text", () => {
    expect(parseChatPayload("PM1IMG:{not-json")).toEqual({ type: "text", text: "" });
    expect(assistantVisibleText("PM1IMG:{not-json")).toBe("");
  });

  it("rejects oversized image metadata without exposing its key to assistants", () => {
    const encoded = encodeImagePayload({
      ...imagePayload,
      bytes: 6_500_001,
    });

    expect(parseChatPayload(encoded)).toEqual({ type: "text", text: "" });
    expect(assistantVisibleText(encoded)).toBe("");
  });

  it("round-trips a multi-photo album as one encrypted message payload", () => {
    const album = {
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          k: "A".repeat(44),
          n: "A".repeat(16),
          mime: "image/jpeg" as const,
          bytes: 28,
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          k: "B".repeat(44),
          n: "B".repeat(16),
          mime: "image/png" as const,
          bytes: 40,
        },
      ],
      caption: "weekend",
    };
    const encoded = encodeAlbumPayload(album);
    expect(parseChatPayload(encoded)).toEqual({ type: "album", ...album });
    expect(assistantVisibleText(encoded)).toBe("weekend");
    expect(messagePreviewText(encoded)).toBe("weekend");
  });

  it("round-trips a multi-message reply payload", () => {
    const reply = {
      refs: [
        { id: "a", preview: "Can we meet?", fromMe: false },
        { id: "b", preview: "Photo", fromMe: true },
      ],
      body: "Yes — after lunch.",
    };
    const encoded = encodeReplyPayload(reply);
    expect(parseChatPayload(encoded)).toEqual({ type: "reply", ...reply });
    expect(assistantVisibleText(encoded)).toBe("Yes — after lunch.");
    expect(messagePreviewText(encoded)).toBe("Yes — after lunch.");
  });

  it("still accepts a voice note that has no waveform", () => {
    const encoded = encodeVoicePayload(voicePayload);
    expect(parseChatPayload(encoded)).toEqual({ type: "voice", ...voicePayload });
  });

  it("round-trips an optional voice waveform and a call log", () => {
    const withWave = encodeVoicePayload({ ...voicePayload, wave: [0, 0.5, 1] });
    expect(parseChatPayload(withWave)).toMatchObject({ type: "voice", wave: [0, 0.5, 1] });
    const call = encodeCallPayload({
      callId: "e8cfa520-3e79-40db-9d85-497a1bdc9917",
      mode: "video",
      outcome: "missed",
      durationSeconds: 0,
      at: "2026-11-27T15:04:00.000Z",
    });
    expect(parseChatPayload(call)).toMatchObject({ type: "call", outcome: "missed" });
    expect(assistantVisibleText(call)).toBe("Missed video call");
    expect(messagePreviewText(call)).toBe("Missed video call");
  });
});
