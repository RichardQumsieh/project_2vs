import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMediaUploadSchema,
  maxEncryptedFileBytes,
  maxEncryptedMediaBytes,
  mediaIdParamSchema,
} from "../src/schemas.js";

describe("media upload schemas", () => {
  it("supports encrypted attachments up to 450 MB plus the AES-GCM tag", () => {
    const result = createMediaUploadSchema.safeParse({
      kind: "file",
      byteSize: maxEncryptedFileBytes,
    });
    assert.equal(result.success, true);
    assert.equal(maxEncryptedFileBytes, 450_000_000 + 16);
  });

  it("accepts encrypted media within the storage limit", () => {
    const result = createMediaUploadSchema.safeParse({ kind: "photo", byteSize: 2048 });
    assert.equal(result.success, true);
  });

  it("rejects empty or oversized encrypted media", () => {
    assert.equal(
      createMediaUploadSchema.safeParse({ kind: "photo", byteSize: 0 }).success,
      false,
    );
    assert.equal(
      createMediaUploadSchema.safeParse({
        kind: "photo",
        byteSize: maxEncryptedMediaBytes + 1,
      }).success,
      false,
    );
    assert.equal(
      createMediaUploadSchema.safeParse({
        kind: "file",
        byteSize: maxEncryptedFileBytes + 1,
      }).success,
      false,
    );
  });

  it("accepts a media id UUID", () => {
    const result = mediaIdParamSchema.safeParse({
      mediaId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(result.success, true);
  });
});
