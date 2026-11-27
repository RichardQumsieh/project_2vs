import {
  encodeAlbumPayload,
  encodeFilePayload,
  encodeImagePayload,
  encodeVideoPayload,
  encodeVoicePayload,
  maxAlbumPhotos,
} from "../../frontend/lib/chat-payload";
import {
  inspectAndEncryptFileAttachmentBytes,
  type EncryptedFileAttachment,
} from "../../frontend/lib/crypto/file-attachment";
import { encryptPhotoBytes } from "../../frontend/lib/crypto/media";
import { encryptVideoBytes } from "../../frontend/lib/crypto/video";
import { encryptVoiceNoteBytes } from "../../frontend/lib/crypto/voice-note";
import { api } from "./api";
import {
  sniffPhotoMime,
  validateNativePhotoAsset,
  validateNativeVideoAsset,
  type NativeMediaAsset,
  type PreparedNativeChatMedia,
} from "./prepare-chat-media-validate";
import { assertOutgoingLinksSafe } from "./url-safety";

export type { NativeMediaAsset, PreparedNativeChatMedia } from "./prepare-chat-media-validate";
export { validateNativePhotoAsset, validateNativeVideoAsset } from "./prepare-chat-media-validate";

async function uploadCiphertext(
  conversationId: string,
  ciphertext: Uint8Array,
  kind: "photo" | "video" | "voice" | "file",
) {
  if (
    ciphertext.byteOffset !== 0 ||
    !(ciphertext.buffer instanceof ArrayBuffer) ||
    ciphertext.byteLength !== ciphertext.buffer.byteLength
  ) {
    throw new Error("The encrypted attachment could not be uploaded safely.");
  }
  const upload = await api.mediaUpload(conversationId, ciphertext.byteLength, kind);
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: ciphertext.buffer,
  });
  if (!response.ok) {
    throw new Error(`The encrypted ${kind} could not be uploaded.`);
  }
  return upload.mediaId;
}

/** Encrypt media on-device, upload ciphertext, return chat plaintext for E2EE send. */
export async function prepareNativeChatMediaPlaintext(
  conversationId: string,
  media: PreparedNativeChatMedia,
): Promise<string> {
  await assertOutgoingLinksSafe(media.caption);
  const caption = media.caption.trim();

  if (media.kind === "album") {
    if (media.assets.length < 2) {
      throw new Error("Choose at least two photos for an album.");
    }
    if (media.assets.length > maxAlbumPhotos) {
      throw new Error(`Albums can include at most ${maxAlbumPhotos} photos.`);
    }
    const items = [];
    for (const asset of media.assets) {
      validateNativePhotoAsset(asset);
      const encrypted = await encryptPhotoBytes(asset.bytes, sniffPhotoMime(asset.bytes, asset.mime));
      const mediaId = await uploadCiphertext(conversationId, encrypted.ciphertext, "photo");
      items.push({
        id: mediaId,
        k: encrypted.key,
        n: encrypted.nonce,
        mime: encrypted.mime,
        w: encrypted.width ?? asset.width,
        h: encrypted.height ?? asset.height,
        bytes: encrypted.ciphertext.byteLength,
      });
    }
    return encodeAlbumPayload({
      items,
      ...(caption ? { caption } : {}),
    });
  }

  if (media.kind === "photo") {
    validateNativePhotoAsset(media.asset);
    const encrypted = await encryptPhotoBytes(
      media.asset.bytes,
      sniffPhotoMime(media.asset.bytes, media.asset.mime),
    );
    const mediaId = await uploadCiphertext(conversationId, encrypted.ciphertext, "photo");
    return encodeImagePayload({
      id: mediaId,
      k: encrypted.key,
      n: encrypted.nonce,
      mime: encrypted.mime,
      w: encrypted.width ?? media.asset.width,
      h: encrypted.height ?? media.asset.height,
      bytes: encrypted.ciphertext.byteLength,
      ...(caption ? { caption } : {}),
    });
  }

  if (media.kind === "video") {
    validateNativeVideoAsset(media.asset);
    const mime = media.asset.mime.includes("webm") ? "video/webm" : "video/mp4";
    const encrypted = await encryptVideoBytes(
      media.asset.bytes,
      mime,
      media.asset.duration ?? 0,
    );
    const mediaId = await uploadCiphertext(conversationId, encrypted.ciphertext, "video");
    return encodeVideoPayload({
      id: mediaId,
      k: encrypted.key,
      n: encrypted.nonce,
      mime: encrypted.mime,
      duration: encrypted.duration,
      bytes: encrypted.ciphertext.byteLength,
      ...(caption ? { caption } : {}),
    });
  }

  if (media.kind === "voice") {
    const mime = media.asset.mime.includes("ogg")
      ? "audio/ogg"
      : media.asset.mime.includes("mp4") || media.asset.mime.includes("m4a") || media.asset.mime.includes("aac")
        ? "audio/mp4"
        : "audio/webm";
    const encrypted = await encryptVoiceNoteBytes(media.asset.bytes, mime, media.duration);
    const mediaId = await uploadCiphertext(conversationId, encrypted.ciphertext, "voice");
    return encodeVoicePayload({
      id: mediaId,
      k: encrypted.key,
      n: encrypted.nonce,
      mime: encrypted.mime,
      duration: media.duration,
      bytes: encrypted.ciphertext.byteLength,
      ...(caption ? { caption } : {}),
    });
  }

  const mediaId = await uploadCiphertext(conversationId, media.attachment.ciphertext, "file");
  return encodeFilePayload({
    id: mediaId,
    k: media.attachment.key,
    n: media.attachment.nonce,
    name: media.attachment.name,
    mime: media.attachment.mime,
    bytes: media.attachment.ciphertext.byteLength,
    containsExternalLinks: media.attachment.containsExternalLinks,
    ...(caption ? { caption } : {}),
  });
}

export async function prepareNativeFileAttachment(
  bytes: Uint8Array,
  fileName: string,
): Promise<EncryptedFileAttachment> {
  return inspectAndEncryptFileAttachmentBytes(bytes, fileName);
}
