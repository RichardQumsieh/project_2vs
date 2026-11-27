import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    mediaUpload: vi.fn(async (_conversationId: string, byteSize: number) => ({
      mediaId: "11111111-1111-4111-8111-111111111111",
      uploadUrl: "https://example.backblazeb2.com/upload",
      headers: { Authorization: "test" },
      byteSize,
    })),
  },
}));

vi.mock("./url-safety", () => ({
  assertOutgoingLinksSafe: vi.fn(async () => undefined),
}));

vi.mock("./crypto/media", () => ({
  encryptPhotoFile: vi.fn(async () => ({
    ciphertext: new Uint8Array(32),
    key: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
    nonce: "abcdefghijklmnop",
    mime: "image/jpeg" as const,
    width: 100,
    height: 80,
  })),
}));

vi.mock("./crypto/video", () => ({
  encryptVideoFile: vi.fn(async () => ({
    ciphertext: new Uint8Array(32),
    key: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
    nonce: "abcdefghijklmnop",
    mime: "video/mp4" as const,
    duration: 3.5,
  })),
}));

vi.mock("./crypto/voice-note", () => ({
  encryptVoiceNoteBytes: vi.fn(async () => ({
    ciphertext: new Uint8Array(32),
    key: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
    nonce: "abcdefghijklmnop",
    mime: "audio/webm" as const,
  })),
}));

describe("prepareChatMediaPlaintext", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  it("uploads an encrypted photo and returns an image payload", async () => {
    const { prepareChatMediaPlaintext } = await import("./prepare-chat-media");
    const { imagePayloadPrefix, parseChatPayload } = await import("./chat-payload");
    const body = await prepareChatMediaPlaintext("conv", {
      kind: "photo",
      file: new File([new Uint8Array([1])], "shot.jpg", { type: "image/jpeg" }),
      caption: "hello",
    });
    expect(body.startsWith(imagePayloadPrefix)).toBe(true);
    const parsed = parseChatPayload(body);
    expect(parsed.type).toBe("image");
    if (parsed.type === "image") expect(parsed.caption).toBe("hello");
  });

  it("uploads an encrypted video payload", async () => {
    const { prepareChatMediaPlaintext } = await import("./prepare-chat-media");
    const { parseChatPayload } = await import("./chat-payload");
    const body = await prepareChatMediaPlaintext("conv", {
      kind: "video",
      file: new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" }),
      caption: "",
    });
    const parsed = parseChatPayload(body);
    expect(parsed.type).toBe("video");
  });
});
