export type RatchetHeader = {
  version: 1;

  /**
   * Current sender ratchet public key.
   *
   * This changes whenever the sender performs a DH ratchet step.
   */
  dh: string;

  /**
   * Message number in the current sending chain.
   */
  n: number;

  /**
   * Number of messages sent in the previous sending chain.
   */
  pn: number;

  recipientDeviceId?: string;

  /**
   * Signed pre-key ID from the initial X3DH handshake.
   */
  spkId?: number;

  /**
   * One-time pre-key ID from the initial X3DH handshake.
   */
  otkId?: number;
};

export type RatchetState = {
  /**
   * Current root key.
   */
  rk: string;

  /**
   * Current local ratchet public key.
   */
  dhPub: string;

  /**
   * Current local ratchet private key in JWK form.
   */
  dhPriv: JsonWebKey;

  /**
   * Remote ratchet public key.
   */
  remoteDh: string | null;

  /**
   * Sending chain key.
   *
   * Undefined when this side has not yet established
   * its first sending chain.
   */
  cks?: string;

  /**
   * Receiving chain key.
   *
   * Undefined when this side has not yet established
   * its first receiving chain.
   */
  ckr?: string;

  /**
   * Number of messages sent in the current sending chain.
   */
  ns: number;

  /**
   * Number of messages received in the current receiving chain.
   */
  nr: number;

  /**
   * Number of messages sent in the previous sending chain.
   */
  pn: number;

  /**
   * Message keys that were skipped because messages arrived
   * out of order.
   *
   * key = `${ratchetPublicKey}:${messageNumber}`
   */
  skipped: Record<string, string>;
};

export type RatchetRole =
  | "initiator"
  | "responder";

export type IdentityMaterial = {
  identity: {
    x25519: {
      publicKey: string;
      privateJwk: JsonWebKey;
    };
    signing: {
      publicKey: string;
      privateJwk: JsonWebKey;
    };
  };

  signedPreKey: {
    keyId: number;
    publicKey: string;
    privateJwk: JsonWebKey;
    signature: string;
  };

  oneTimePreKeys: Array<{
    keyId: number;
    publicKey: string;
    privateJwk: JsonWebKey;
  }>;
};

export type VaultRecord = {
  userId?: string;
  version?: number;
  salt: string;
  ciphertext: string;
  nonce: string;
};

export type SessionHandshake = {
  /** Initial X3DH prekey identifiers retained for device recovery. */
  spkId: number;
  otkId?: number;
};

export type SessionDirection =
  | "incoming"
  | "outgoing";

export type StoredSession = {
  conversationId: string;

  remoteDeviceId: string;

  direction: SessionDirection;

  remoteIdentity: string;

  handshake?: SessionHandshake;

  state: RatchetState;
};

export type SessionRecord = StoredSession;

export type LocalMessage = {
  id: string;

  conversationId: string;

  senderDeviceId: string;

  senderUserId?: string;

  logicalMessageId?: string;

  fromMe: boolean;

  plaintext: string;

  createdAt: string;
};

export type WireMessage = {
  id: string;

  conversationId: string;

  senderDeviceId: string;

  senderUserId?: string;

  recipientDeviceId?: string;

  logicalMessageId?: string | null;

  senderIdentityPublicKey: string;

  ciphertext: string;

  nonce: string;

  ratchetHeader: RatchetHeader;

  createdAt: string;
};

export type DirectSendPayload = {
  senderDeviceId: string;
  logicalMessageId: string;
  envelopes: { recipientDeviceId: string; ciphertext: string; nonce: string; ratchetHeader: unknown }[];
  archiveEnvelopes: { ownerUserId: string; recipientPublicKey: string; ephemeralPublicKey: string; nonce: string; ciphertext: string }[];
};

export type PendingDirectSend = {
  id: string;
  conversationId: string;
  plaintext: string;
  createdAt: string;
  payload: DirectSendPayload;
};
