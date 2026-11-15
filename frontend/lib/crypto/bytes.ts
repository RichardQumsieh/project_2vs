export function asBufferSource(
  bytes: Uint8Array,
): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function randomBytes(
  length: number,
): Uint8Array {
  const result = new Uint8Array(length);

  crypto.getRandomValues(result);

  return result;
}

export function utf8ToBytes(
  value: string,
): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToUtf8(
  value: Uint8Array,
): string {
  return new TextDecoder().decode(value);
}

export function bytesToB64(
  bytes: Uint8Array,
): string {
  let binary = "";

  const chunkSize = 0x8000;

  for (
    let offset = 0;
    offset < bytes.length;
    offset += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        offset,
        Math.min(
          offset + chunkSize,
          bytes.length,
        ),
      ),
    );
  }

  return btoa(binary);
}

export function b64ToBytes(
  value: string,
): Uint8Array {
  const binary = atob(value);

  const bytes = new Uint8Array(
    binary.length,
  );

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function concatBytes(
  ...arrays: Uint8Array[]
): Uint8Array {
  const totalLength = arrays.reduce(
    (sum, array) => sum + array.length,
    0,
  );

  const result = new Uint8Array(
    totalLength,
  );

  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

export function equalBytes(
  a: Uint8Array,
  b: Uint8Array,
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i += 1) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}