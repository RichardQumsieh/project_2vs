import {
  asBufferSource,
  b64ToBytes,
  bytesToB64,
  concatBytes,
  utf8ToBytes,
} from "./bytes";

import {
  dh,
  generateX25519,
} from "./keys";

import {
  initInitiatorState,
  initResponderState,
} from "./ratchet";

import type {
  IdentityMaterial,
  RatchetState,
  SessionHandshake,
} from "./types";

export type PreKeyBundle = {
  deviceId: string;

  identityPublicKey: string;

  signingPublicKey: string;

  signedPreKey: {
    id: number;
    publicKey: string;
    signature: string;
  };

  oneTimePreKey?: {
    id: number;
    publicKey: string;
  };
};

export type InitiatedSession = {
  remoteDeviceId: string;

  remoteIdentity: string;

  extra: SessionHandshake;

  state: RatchetState;
};

export type AcceptedSession = {
  remoteDeviceId?: string;

  state: RatchetState;
};

/**
 * NOTE:
 *
 * This is the X25519 DH material used to establish
 * the initial shared secret.
 *
 * Authentication/signature verification must also be
 * performed by the application before accepting the
 * bundle in a production protocol.
 */
async function deriveX3DHSecretInitiator(
  identity: IdentityMaterial,
  bundle: PreKeyBundle,
  ephemeralPrivate: JsonWebKey,
): Promise<Uint8Array> {
  const identityPrivate =
    identity.identity.x25519.privateJwk;

  const signedPreKey =
    b64ToBytes(
      bundle.signedPreKey.publicKey,
    );

  const identityPublic =
    b64ToBytes(
      identity.identity.x25519.publicKey,
    );

  const dh1 =
    await dh(
      identityPrivate,
      signedPreKey,
    );

  const dh2 =
    await dh(
      ephemeralPrivate,
      b64ToBytes(
        bundle.identityPublicKey,
      ),
    );

  const dh3 =
    await dh(
      ephemeralPrivate,
      signedPreKey,
    );

  const components = [
    dh1,
    dh2,
    dh3,
  ];

  if (
    bundle.oneTimePreKey
  ) {
    components.push(
      await dh(
        ephemeralPrivate,
        b64ToBytes(
          bundle.oneTimePreKey.publicKey,
        ),
      ),
    );
  }

  return deriveHandshakeSecret(
    components,
    identityPublic,
    b64ToBytes(
      bundle.identityPublicKey,
    ),
  );
}

async function deriveHandshakeSecret(
  components: Uint8Array[],
  initiatorIdentityPublic: Uint8Array,
  responderIdentityPublic: Uint8Array,
): Promise<Uint8Array> {
  const material =
    concatBytes(
      utf8ToBytes(
        "private-messenger/x3dh/v1",
      ),
      initiatorIdentityPublic,
      responderIdentityPublic,
      ...components,
    );

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      asBufferSource(material),
    );

  return new Uint8Array(
    digest,
  );
}

export async function initiateSession(
  identity: IdentityMaterial,
  bundle: PreKeyBundle,
): Promise<InitiatedSession> {
  /**
   * Generate fresh ephemeral X25519 key.
   */
  const ephemeral =
    await generateX25519();

  /**
   * Calculate X3DH shared secret.
   */
  const secret =
    await deriveX3DHSecretInitiator(
      identity,
      bundle,
      ephemeral.privateJwk,
    );

  /**
   * IMPORTANT:
   *
   * The initial DH ratchet public key is the
   * ephemeral X25519 public key.
   */
  const state =
    await initInitiatorState(
      secret,
      ephemeral,
      b64ToBytes(
        bundle.signedPreKey.publicKey,
      ),
    );

  return {
    remoteDeviceId:
      bundle.deviceId,

    remoteIdentity:
      bundle.identityPublicKey,

    extra: {
      spkId:
        bundle.signedPreKey.id,

      ...(bundle.oneTimePreKey
        ? {
            otkId:
              bundle.oneTimePreKey.id,
          }
        : {}),
    },

    state,
  };
}

/**
 * Responder-side X3DH acceptance.
 *
 * The caller must supply the exact private keys
 * corresponding to the pre-keys referenced by the
 * incoming message.
 */
export async function acceptSession(
  identity: IdentityMaterial,
  initiatorIdentityPublic: string,
  initiatorEphemeralPublic: string,
  otkId?: number,
): Promise<RatchetState> {
  const initiatorIdentity =
    b64ToBytes(
      initiatorIdentityPublic,
    );

  const initiatorEphemeral =
    b64ToBytes(
      initiatorEphemeralPublic,
    );

  const signedPreKeyPrivate =
    identity.signedPreKey.privateJwk;

  const dh1 =
    await dh(
      signedPreKeyPrivate,
      initiatorIdentity,
    );

  const dh2 =
    await dh(
      identity.identity.x25519.privateJwk,
      initiatorEphemeral,
    );

  const dh3 =
    await dh(
      signedPreKeyPrivate,
      initiatorEphemeral,
    );

  const components = [
    dh1,
    dh2,
    dh3,
  ];

  if (
    otkId !== undefined
  ) {
    const otk =
      identity.oneTimePreKeys.find(
        (item) =>
          item.keyId === otkId,
      );

    if (!otk) {
      throw new Error(
        `One-time pre-key ${otkId} is not available`,
      );
    }

    components.push(
      await dh(
        otk.privateJwk,
        initiatorEphemeral,
      ),
    );
  }

  const secret =
    await deriveHandshakeSecret(
      components,
      initiatorIdentity,
      b64ToBytes(
        identity.identity.x25519.publicKey,
      ),
    );

  return initResponderState(
    secret,
    {
      publicKey:
        b64ToBytes(
          identity.signedPreKey.publicKey,
        ),

      privateJwk:
        signedPreKeyPrivate,
    },
    initiatorEphemeral,
  );
}