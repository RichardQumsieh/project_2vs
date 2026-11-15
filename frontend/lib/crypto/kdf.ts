import {
  asBufferSource,
  bytesToB64,
  b64ToBytes,
  concatBytes,
  utf8ToBytes,
} from "./bytes";

const HASH = "SHA-256";

const ROOT_INFO =
  utf8ToBytes(
    "private-messenger/double-ratchet/root/v1",
  );

const CHAIN_INFO =
  utf8ToBytes(
    "private-messenger/double-ratchet/chain/v1",
  );

const MESSAGE_INFO =
  utf8ToBytes(
    "private-messenger/double-ratchet/message/v1",
  );

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key =
    await crypto.subtle.importKey(
      "raw",
      asBufferSource(ikm),
      "HKDF",
      false,
      ["deriveBits"],
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: HASH,
        salt: asBufferSource(salt),
        info: asBufferSource(info),
      },
      key,
      length * 8,
    );

  return new Uint8Array(bits);
}

/**
 * Derives a new root key and chain key from:
 *
 * currentRootKey + DH output
 */
export async function kdfRoot(
  rootKey: Uint8Array,
  dhOutput: Uint8Array,
): Promise<{
  rootKey: Uint8Array;
  chainKey: Uint8Array;
}> {
  const derived =
    await hkdf(
      dhOutput,
      rootKey,
      ROOT_INFO,
      64,
    );

  return {
    rootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

/**
 * Derives:
 *
 * messageKey
 * nextChainKey
 *
 * from the current chain key.
 */
export async function kdfChain(
  chainKey: Uint8Array,
): Promise<{
  messageKey: Uint8Array;
  nextChainKey: Uint8Array;
}> {
  const zeroSalt = new Uint8Array(32);

  const derived =
    await hkdf(
      chainKey,
      zeroSalt,
      CHAIN_INFO,
      64,
    );

  return {
    messageKey: derived.slice(0, 32),
    nextChainKey: derived.slice(32, 64),
  };
}

/**
 * Derives the first directional chain from
 * the X3DH shared secret.
 *
 * We deliberately derive separate values for
 * initiator-send and responder-receive.
 */
export async function deriveInitialRatchet(
  sharedSecret: Uint8Array,
): Promise<{
  rootKey: Uint8Array;
  chainKey: Uint8Array;
}> {
  const zeroSalt = new Uint8Array(32);

  const info = utf8ToBytes(
    "private-messenger/double-ratchet/initial/v1",
  );

  const derived = await hkdf(
    sharedSecret,
    zeroSalt,
    info,
    64,
  );

  return {
    rootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

/**
 * Useful for deriving a deterministic session
 * identifier / debugging fingerprint.
 */
export async function sha256(
  input: Uint8Array,
): Promise<Uint8Array> {
  const digest =
    await crypto.subtle.digest(
      HASH,
      asBufferSource(input),
    );

  return new Uint8Array(digest);
}

export async function fingerprint(
  input: Uint8Array,
): Promise<string> {
  return bytesToB64(
    await sha256(input),
  );
}

export async function deriveVaultKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    asBufferSource(utf8ToBytes(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBufferSource(salt), iterations: 310000, hash: HASH },
    material,
    256,
  );
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function x3dhSecret(parts: Uint8Array[]) {
  return hkdf(concatBytes(...parts), new Uint8Array(32), utf8ToBytes("2VS-X3DH"), 32);
}