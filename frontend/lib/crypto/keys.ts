import {
  asBufferSource,
  b64ToBytes,
  bytesToB64,
} from "./bytes";

export type X25519KeyPair = {
  publicKey: Uint8Array;
  privateJwk: JsonWebKey;
};

export async function generateX25519(): Promise<X25519KeyPair> {
  const keyPair =
    (await crypto.subtle.generateKey(
      {
        name: "X25519",
      },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;

  const publicJwk =
    await crypto.subtle.exportKey(
      "jwk",
      keyPair.publicKey,
    );

  const privateJwk =
    await crypto.subtle.exportKey(
      "jwk",
      keyPair.privateKey,
    );

  if (!publicJwk.x) {
    throw new Error(
      "Generated X25519 public key has no x coordinate",
    );
  }

  return {
    publicKey: b64ToBytes(
      base64UrlToBase64(publicJwk.x),
    ),
    privateJwk,
  };
}

export async function importX25519Private(
  privateJwk: JsonWebKey,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    privateJwk,
    {
      name: "X25519",
    },
    false,
    ["deriveBits"],
  );
}

export async function importX25519Public(
  publicKey: Uint8Array,
): Promise<CryptoKey> {
  const jwk: JsonWebKey = {
    kty: "OKP",
    crv: "X25519",
    x: base64ToBase64Url(
      bytesToB64(publicKey),
    ),
  };

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "X25519",
    },
    false,
    [],
  );
}

export async function dh(
  privateJwk: JsonWebKey,
  remotePublicKey: Uint8Array,
): Promise<Uint8Array> {
  const privateKey =
    await importX25519Private(
      privateJwk,
    );

  const publicKey =
    await importX25519Public(
      remotePublicKey,
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: "X25519",
        public: publicKey,
      },
      privateKey,
      256,
    );

  return new Uint8Array(bits);
}

export async function generateEd25519() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
  };
}

export async function signBytes(privateJwk: JsonWebKey, data: Uint8Array) {
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("Ed25519", key, asBufferSource(data)));
}

export async function verifyBytes(publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", asBufferSource(publicKey), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, asBufferSource(signature), asBufferSource(data));
}

function base64ToBase64Url(
  value: string,
): string {
  return value
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBase64(
  value: string,
): string {
  const normalized =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const padding =
    normalized.length % 4;

  if (padding === 0) {
    return normalized;
  }

  return (
    normalized +
    "=".repeat(4 - padding)
  );
}