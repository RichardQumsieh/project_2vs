export const maxGroupCallParticipants = 4;

export type GroupCallMode = "audio" | "video";

export type GroupCallRecord = {
  kind: "group";
  conversationId: string;
  callerId: string;
  mode: GroupCallMode;
  participantIds: string[];
  joinedIds: string[];
  status: "ringing" | "active";
};

export function createGroupCall(input: {
  conversationId: string;
  callerId: string;
  mode: GroupCallMode;
  memberIds: readonly string[];
}): GroupCallRecord {
  const participantIds = [...new Set(input.memberIds)];
  if (!participantIds.includes(input.callerId)) {
    throw new Error("You are not a participant in this call.");
  }
  if (participantIds.length < 2 || participantIds.length > maxGroupCallParticipants) {
    throw new Error(`Group calls support 2 to ${maxGroupCallParticipants} people.`);
  }
  return {
    kind: "group",
    conversationId: input.conversationId,
    callerId: input.callerId,
    mode: input.mode,
    participantIds,
    joinedIds: [input.callerId],
    status: "ringing",
  };
}

export function isGroupCallRecord(value: unknown): value is GroupCallRecord {
  return Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    (value as { kind?: string }).kind === "group" &&
    Array.isArray((value as { participantIds?: unknown }).participantIds),
  );
}

export function joinGroupCall(state: GroupCallRecord, userId: string): GroupCallRecord {
  if (state.conversationId.length === 0 || !state.participantIds.includes(userId)) {
    throw new Error("You are not a participant in this call.");
  }
  const joinedIds = state.joinedIds.includes(userId)
    ? state.joinedIds
    : [...state.joinedIds, userId];
  return {
    ...state,
    joinedIds,
    status: joinedIds.length >= 2 ? "active" : "ringing",
  };
}

export function leaveGroupCall(state: GroupCallRecord, userId: string): {
  state: GroupCallRecord | null;
  ended: boolean;
  notifyIds: string[];
} {
  if (!state.participantIds.includes(userId)) {
    throw new Error("You are not a participant in this call.");
  }
  const participantIds = state.participantIds.filter((id) => id !== userId);
  const joinedIds = state.joinedIds.filter((id) => id !== userId);
  const notifyIds = participantIds;
  if (participantIds.length < 2 || joinedIds.length === 0) {
    return { state: null, ended: true, notifyIds };
  }
  return {
    ended: false,
    notifyIds,
    state: {
      ...state,
      participantIds,
      joinedIds,
      status: joinedIds.length >= 2 ? "active" : "ringing",
    },
  };
}

export function assertGroupMediaRoute(state: GroupCallRecord, senderId: string, peerId: string) {
  if (senderId === peerId) {
    throw new Error("Call media cannot be routed to yourself.");
  }
  if (!state.participantIds.includes(senderId) || !state.participantIds.includes(peerId)) {
    throw new Error("You are not a participant in this call.");
  }
  if (!state.joinedIds.includes(senderId) || !state.joinedIds.includes(peerId)) {
    throw new Error("Join the call before sending media.");
  }
}

/** Exactly one side of a mesh pair creates the offer, so both sides don't glare. */
export function shouldCreateGroupOffer(localUserId: string, remoteUserId: string) {
  return localUserId < remoteUserId;
}
