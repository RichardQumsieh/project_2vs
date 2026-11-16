import { ratchetEncrypt } from "./ratchet";
import type { IdentityMaterial, RatchetHeader, StoredSession } from "./types";
import { initiateSession, type PreKeyBundle } from "./x3dh";

export type EncryptedDeviceEnvelope = {
  recipientDeviceId: string;
  ciphertext: string;
  nonce: string;
  ratchetHeader: RatchetHeader;
};

export async function encryptForDevice(
  identity: IdentityMaterial,
  conversationId: string,
  plaintext: string,
  recipientDeviceId: string,
  bundle: PreKeyBundle | undefined,
  existingSession: StoredSession | undefined,
): Promise<{ envelope: EncryptedDeviceEnvelope; session: StoredSession }> {
  let session = existingSession;

  if (!session) {
    if (!bundle || bundle.deviceId !== recipientDeviceId) {
      throw new Error(`Missing prekey bundle for device ${recipientDeviceId}`);
    }

    const initiated = await initiateSession(identity, bundle);
    session = {
      conversationId,
      remoteDeviceId: initiated.remoteDeviceId,
      direction: "outgoing",
      remoteIdentity: initiated.remoteIdentity,
      handshake: initiated.extra,
      state: initiated.state,
    };
  }

  if (
    session.conversationId !== conversationId ||
    session.remoteDeviceId !== recipientDeviceId ||
    session.direction !== "outgoing"
  ) {
    throw new Error("The stored outgoing session does not match its recipient device");
  }

  const workingSession: StoredSession = {
    ...session,
    state: structuredClone(session.state),
  };
  const encrypted = await ratchetEncrypt(
    workingSession.state,
    plaintext,
    {
      ...workingSession.handshake,
      recipientDeviceId,
    },
  );
  workingSession.state = encrypted.state;

  return {
    envelope: {
      recipientDeviceId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      ratchetHeader: encrypted.ratchetHeader,
    },
    session: workingSession,
  };
}
