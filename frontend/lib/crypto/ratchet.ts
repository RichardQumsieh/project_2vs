import { asBufferSource, b64ToBytes, bytesToB64, randomBytes, utf8ToBytes, bytesToUtf8 } from "./bytes";
import { deriveInitialRatchet, kdfChain, kdfRoot } from "./kdf";
import { dh, generateX25519 } from "./keys";
import type { RatchetHeader, RatchetState } from "./types";

const MAX_SKIP = 64;

function skippedKey(dhPub: string, n: number) {
  return `${dhPub}:${n}`;
}

async function encryptWithMk(messageKey: Uint8Array, plaintext: string, aad: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", asBufferSource(messageKey), "AES-GCM", false, ["encrypt"]);
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce), additionalData: asBufferSource(aad) },
      key,
      asBufferSource(utf8ToBytes(plaintext)),
    ),
  );
  return { ciphertext: bytesToB64(ciphertext), nonce: bytesToB64(nonce) };
}

async function decryptWithMk(
  messageKey: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
) {
  const key = await crypto.subtle.importKey("raw", asBufferSource(messageKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(nonce), additionalData: asBufferSource(aad) },
    key,
    asBufferSource(ciphertext),
  );
  return bytesToUtf8(new Uint8Array(plaintext));
}

function headerAad(
  header: RatchetHeader,
): Uint8Array {
  const canonicalHeader = {
    version: header.version,
    dh: header.dh,
    n: header.n,
    pn: header.pn,

    ...(header.spkId !== undefined
      ? {
          spkId: header.spkId,
        }
      : {}),

    ...(header.otkId !== undefined
      ? {
          otkId: header.otkId,
        }
      : {}),
    ...(header.recipientDeviceId !== undefined
      ? {
          recipientDeviceId: header.recipientDeviceId,
        }
      : {}),
  };

  return utf8ToBytes(
    JSON.stringify(
      canonicalHeader,
    ),
  );
}

async function dhRatchet(state: RatchetState, remoteDh: string) {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.remoteDh = remoteDh;
  const receiving = await kdfRoot(b64ToBytes(state.rk), await dh(state.dhPriv, b64ToBytes(remoteDh)));
  state.rk = bytesToB64(receiving.rootKey);
  state.ckr = bytesToB64(receiving.chainKey);

  const next = await generateX25519();
  state.dhPriv = next.privateJwk;
  state.dhPub = bytesToB64(next.publicKey);
  const sending = await kdfRoot(b64ToBytes(state.rk), await dh(state.dhPriv, b64ToBytes(remoteDh)));
  state.rk = bytesToB64(sending.rootKey);
  state.cks = bytesToB64(sending.chainKey);
}

async function skipMessageKeys(state: RatchetState, until: number) {
  if (!state.ckr) return;
  if (until - state.nr > MAX_SKIP) {
    throw new Error("Too many skipped messages");
  }
  while (state.nr < until) {
    const { messageKey, nextChainKey } = await kdfChain(b64ToBytes(state.ckr));
    state.skipped[skippedKey(state.remoteDh ?? "", state.nr)] = bytesToB64(messageKey);
    state.ckr = bytesToB64(nextChainKey);
    state.nr += 1;
  }
}

export async function initInitiatorState(
  secret: Uint8Array,
  localDh: {
    publicKey: Uint8Array;
    privateJwk: JsonWebKey;
  },
  remoteDh: Uint8Array,
): Promise<RatchetState> {
  const derived = await deriveInitialRatchet(secret);

  return {
    dhPub: bytesToB64(localDh.publicKey),
    dhPriv: localDh.privateJwk,

    remoteDh: bytesToB64(remoteDh),

    rk: bytesToB64(derived.rootKey),

    // Alice can send immediately.
    cks: bytesToB64(derived.chainKey),

    // Alice cannot receive until Bob performs
    // the first DH ratchet.
    ckr: undefined,

    ns: 0,
    nr: 0,
    pn: 0,

    skipped: {},
  };
}

export async function initResponderState(
  secret: Uint8Array,
  localDh: {
    publicKey: Uint8Array;
    privateJwk: JsonWebKey;
  },
  remoteDh: Uint8Array,
): Promise<RatchetState> {
  const derived = await deriveInitialRatchet(secret);

  return {
    dhPub: bytesToB64(localDh.publicKey),
    dhPriv: localDh.privateJwk,

    remoteDh: bytesToB64(remoteDh),

    rk: bytesToB64(derived.rootKey),

    // Bob initially receives.
    cks: undefined,

    // Must be the SAME chain key Alice has for sending.
    ckr: bytesToB64(derived.chainKey),

    ns: 0,
    nr: 0,
    pn: 0,

    skipped: {},
  };
}

export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
  extra: Pick<RatchetHeader, "spkId" | "otkId" | "recipientDeviceId"> = {},
) {
  const sendingChain = state.cks;
  if (!sendingChain) throw new Error("Sending chain is not initialized");
  const { messageKey, nextChainKey } = await kdfChain(b64ToBytes(sendingChain));
  state.cks = bytesToB64(nextChainKey);
  const header: RatchetHeader = {
    version: 1,
    dh: state.dhPub,
    n: state.ns,
    pn: state.pn,
    ...extra,
  };
  state.ns += 1;

  const aad = headerAad(header);

  const encrypted = await encryptWithMk(
    messageKey,
    plaintext,
    aad,
  );

  return { ...encrypted, ratchetHeader: header, state };
}

export async function ratchetDecrypt(
  state: RatchetState,
  header: RatchetHeader,
  ciphertext: string,
  nonce: string,
) {
  const skippedId = skippedKey(header.dh, header.n);
  const skipped = state.skipped[skippedId];

  if (skipped) {
    const aad = headerAad(header);

    const plaintext = await decryptWithMk(
      b64ToBytes(skipped),
      b64ToBytes(ciphertext),
      b64ToBytes(nonce),
      aad,
    );

    delete state.skipped[skippedId];

    return {
      plaintext,
      state,
    };
  }

  if (header.dh !== state.remoteDh) {
    if (state.ckr) {
      await skipMessageKeys(state, header.pn);
    }

    await dhRatchet(state, header.dh);
  }

  if (!state.ckr) {
    throw new Error(
      "Receiving chain is not initialized",
    );
  }

  await skipMessageKeys(
    state,
    header.n,
  );

  const currentChainKey =
    b64ToBytes(state.ckr);

  const {
    messageKey,
    nextChainKey,
  } = await kdfChain(
    currentChainKey,
  );

  const aad =
    headerAad(header);

  /*
   * IMPORTANT:
   *
   * Do not advance the chain until
   * AES-GCM authentication succeeds.
   */
  const plaintext =
    await decryptWithMk(
      messageKey,
      b64ToBytes(ciphertext),
      b64ToBytes(nonce),
      aad,
    );

  state.ckr =
    bytesToB64(nextChainKey);

  state.nr += 1;

  return {
    plaintext,
    state,
  };
}
