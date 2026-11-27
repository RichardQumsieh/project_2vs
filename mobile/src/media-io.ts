import {
  cacheDirectory,
  EncodingType,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import { b64ToBytes, bytesToB64 } from "../../frontend/lib/crypto/bytes";

export async function readUriBytes(uri: string): Promise<Uint8Array> {
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  return b64ToBytes(base64);
}

export function bytesToDataUri(bytes: Uint8Array, mime: string) {
  return `data:${mime};base64,${bytesToB64(bytes)}`;
}

export async function writeCacheBytes(bytes: Uint8Array, fileName: string) {
  const root = cacheDirectory;
  if (!root) throw new Error("This device has no writable media cache.");
  const uri = `${root}${fileName}`;
  await writeAsStringAsync(uri, bytesToB64(bytes), { encoding: EncodingType.Base64 });
  return uri;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}
