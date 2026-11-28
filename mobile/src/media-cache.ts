import { Directory, File, Paths } from "expo-file-system";
import {
  EncodingType,
  FileSystemUploadType,
  cacheDirectory,
  deleteAsync,
  downloadAsync,
  readAsStringAsync,
  readDirectoryAsync,
  uploadAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import { cacheExpiry, decodeCacheBytes, isCacheExpired, sanitizeCacheFileName } from "./media-bytes";

const CACHE_FOLDER = "sophia-plaintext";

function plaintextDirectory() {
  const directory = new Directory(Paths.cache, CACHE_FOLDER);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export async function writeDecryptedFile(bytes: Uint8Array, fileName: string) {
  const safe = sanitizeCacheFileName(fileName);
  const directory = plaintextDirectory();
  const file = new File(directory, safe);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  await writeAsStringAsync(expiryUri(file.uri), String(cacheExpiry(Date.now())));
  return file.uri;
}

function expiryUri(fileUri: string) {
  return `${fileUri}.exp`;
}

export async function wipeDecryptedCache() {
  const directory = new Directory(Paths.cache, CACHE_FOLDER);
  if (directory.exists) directory.delete();
}

export async function sweepDecryptedCache(now = Date.now()) {
  const directory = new Directory(Paths.cache, CACHE_FOLDER);
  if (!directory.exists) return;
  const names = await readDirectoryAsync(directory.uri).catch(() => [] as string[]);
  await Promise.all(names.filter((name) => name.endsWith(".exp")).map(async (name) => {
    const stamp = new File(directory, name);
    const expiresAt = Number(await readAsStringAsync(stamp.uri));
    if (!isCacheExpired(expiresAt, now)) return;
    const media = new File(directory, name.slice(0, -4));
    if (media.exists) media.delete();
    if (stamp.exists) stamp.delete();
  }));
}

export async function readRemoteCiphertext(url: string, expectedBytes: number, maxBytes: number) {
  const root = cacheDirectory;
  if (!root) throw new Error("This device has no writable media cache.");
  const dest = `${root}sophia-ct-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`;
  try {
    const result = await downloadAsync(url, dest);
    if (result.status < 200 || result.status >= 300) {
      throw new Error("The attachment could not be downloaded.");
    }
    const bytes = decodeCacheBytes(await readAsStringAsync(dest, { encoding: EncodingType.Base64 }));
    if (bytes.byteLength !== expectedBytes || bytes.byteLength > maxBytes || bytes.byteLength === 0) {
      throw new Error("The downloaded attachment has an invalid size.");
    }
    return bytes;
  } finally {
    await deleteAsync(dest, { idempotent: true }).catch(() => undefined);
  }
}

export async function uploadCiphertextFile(url: string, headers: Record<string, string>, bytes: Uint8Array) {
  const file = new File(Paths.cache, `sophia-up-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  try {
    const result = await uploadAsync(url, file.uri, {
      httpMethod: "PUT",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error("The encrypted attachment could not be uploaded.");
    }
  } finally {
    if (file.exists) file.delete();
  }
}
