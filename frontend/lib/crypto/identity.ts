import { bytesToB64 } from "./bytes";
import { generateEd25519, generateX25519, signBytes } from "./keys";
import type { IdentityMaterial } from "./types";

export async function createIdentityMaterial(otkCount = 50): Promise<IdentityMaterial> {
  const x25519 = await generateX25519();
  const signing = await generateEd25519();
  const signedPreKey = await generateX25519();
  const signature = await signBytes(signing.privateJwk, signedPreKey.publicKey);

  const oneTimePreKeys = [];
  for (let keyId = 0; keyId < otkCount; keyId += 1) {
    const otk = await generateX25519();
    oneTimePreKeys.push({
      keyId,
      publicKey: bytesToB64(otk.publicKey),
      privateJwk: otk.privateJwk,
    });
  }

  return {
    identity: {
      x25519: {
        publicKey: bytesToB64(x25519.publicKey),
        privateJwk: x25519.privateJwk,
      },
      signing: {
        publicKey: bytesToB64(signing.publicKey),
        privateJwk: signing.privateJwk,
      },
    },
    signedPreKey: {
      keyId: 1,
      publicKey: bytesToB64(signedPreKey.publicKey),
      privateJwk: signedPreKey.privateJwk,
      signature: bytesToB64(signature),
    },
    oneTimePreKeys,
  };
}

export function devicePayload(identity: IdentityMaterial, deviceName: string) {
  return {
    deviceName,
    identityPublicKey: identity.identity.x25519.publicKey,
    signingPublicKey: identity.identity.signing.publicKey,
    signedPreKeyId: identity.signedPreKey.keyId,
    signedPreKey: identity.signedPreKey.publicKey,
    signedPreKeySig: identity.signedPreKey.signature,
    oneTimePreKeys: identity.oneTimePreKeys.map((key) => ({
      keyId: key.keyId,
      publicKey: key.publicKey,
    })),
  };
}
