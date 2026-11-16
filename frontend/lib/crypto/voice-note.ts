import { asBufferSource, b64ToBytes, bytesToB64, randomBytes } from "./bytes";
import {
  maxEncryptedVoiceNoteBytes,
  type VoiceChatPayload,
} from "../chat-payload";

export const maxVoiceNoteSourceBytes = maxEncryptedVoiceNoteBytes - 16;
export const voiceNoteBitrate = 48_000;

export type VoiceNoteMime = VoiceChatPayload["mime"];

export type EncryptedVoiceNote = {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
  mime: VoiceNoteMime;
};

export function validateVoiceNoteDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("The voice note has an invalid duration.");
  }
}

export function resampleMonoAudio(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  targetSampleRate = 16_000,
) {
  if (
    channels.length === 0 ||
    !Number.isFinite(sourceSampleRate) ||
    !Number.isFinite(targetSampleRate) ||
    sourceSampleRate <= 0 ||
    targetSampleRate <= 0
  ) {
    throw new Error("Could not prepare audio for local captions.");
  }
  const frameCount = Math.min(...channels.map((channel) => channel.length));
  if (frameCount === 0) {
    throw new Error("No audio was recorded.");
  }
  const outputLength = Math.max(1, Math.ceil(frameCount * targetSampleRate / sourceSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(Math.floor(sourcePosition), frameCount - 1);
    const rightIndex = Math.min(leftIndex + 1, frameCount - 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      sample += channel[leftIndex] * (1 - fraction) + channel[rightIndex] * fraction;
    }
    output[index] = sample / channels.length;
  }
  return output;
}

export async function encryptVoiceNoteBytes(
  plaintext: Uint8Array,
  mime: VoiceNoteMime,
  duration: number,
): Promise<EncryptedVoiceNote> {
  validateVoiceNoteDuration(duration);
  if (plaintext.byteLength === 0 || plaintext.byteLength > maxVoiceNoteSourceBytes) {
    throw new Error("The voice note exceeds the media storage limit.");
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      asBufferSource(plaintext),
    ),
  );
  if (ciphertext.byteLength > maxEncryptedVoiceNoteBytes) {
    throw new Error("The encrypted voice note exceeds the media storage limit.");
  }
  return {
    ciphertext,
    key: bytesToB64(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
    nonce: bytesToB64(nonce),
    mime,
  };
}

export async function decryptVoiceNoteBytes(
  ciphertext: Uint8Array,
  keyB64: string,
  nonceB64: string,
  mime: VoiceNoteMime,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(b64ToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(b64ToBytes(nonceB64)) },
      key,
      asBufferSource(ciphertext),
    ),
  );
  return new Blob([asBufferSource(plaintext)], { type: mime });
}
