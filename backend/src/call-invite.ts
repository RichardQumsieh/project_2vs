import { isGroupCallRecord, type GroupCallRecord } from "./group-call.js";

export type DirectCallState = {
  conversationId: string;
  callerId: string;
  calleeId: string;
  status: "ringing" | "active";
};

export type StoredCallInvite = {
  callId: string;
  conversationId: string;
  senderId: string;
  mode: "audio" | "video";
  scope: "direct" | "group";
  offer?: { type: "offer"; sdp: string };
};

export function isStoredInvite(value: unknown): value is StoredCallInvite {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.callId !== "string" ||
    typeof record.conversationId !== "string" ||
    typeof record.senderId !== "string" ||
    (record.mode !== "audio" && record.mode !== "video") ||
    (record.scope !== "direct" && record.scope !== "group")
  ) {
    return false;
  }
  if (record.offer === undefined) return true;
  if (!record.offer || typeof record.offer !== "object") return false;
  const offer = record.offer as { type?: unknown; sdp?: unknown };
  return offer.type === "offer" && typeof offer.sdp === "string" && offer.sdp.length > 0 && offer.sdp.length <= 64 * 1024;
}

export type InviteRead =
  | { ok: true; invite: StoredCallInvite }
  | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * The push payload does not include the SDP. A woken client fetches it here.
 * Only a participant can read a still-ringing invite.
 */
export function readRingingInvite(input: {
  userId: string;
  state: DirectCallState | GroupCallRecord | null;
  invite: StoredCallInvite | null;
}): InviteRead {
  if (!input.state || !input.invite) {
    return { ok: false, status: 404, error: "This call has ended." };
  }
  if (input.invite.conversationId !== input.state.conversationId) {
    return { ok: false, status: 404, error: "This call has ended." };
  }
  if (input.state.status !== "ringing") {
    return { ok: false, status: 409, error: "This call is no longer ringing." };
  }
  if (isGroupCallRecord(input.state)) {
    if (!input.state.participantIds.includes(input.userId) || input.userId === input.state.callerId) {
      return { ok: false, status: 403, error: "You are not being called." };
    }
  } else if (input.userId !== input.state.calleeId) {
    return { ok: false, status: 403, error: "You are not being called." };
  }
  return {
    ok: true,
    invite: {
      callId: input.invite.callId,
      conversationId: input.invite.conversationId,
      senderId: input.invite.senderId,
      mode: input.invite.mode,
      scope: input.invite.scope,
      ...(input.invite.offer ? { offer: input.invite.offer } : {}),
    },
  };
}
