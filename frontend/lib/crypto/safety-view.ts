import {
  accountFingerprint,
  bytesToHex,
  directSafetyNumber,
  groupSafetyNumber,
  type SafetyMember,
} from "./safety-number";
import {
  acceptSafetyChange,
  assessSafety,
  localDeviceStatus,
  markSafetyVerified,
  observeSafety,
  type LocalIdentity,
  type SafetyStatus,
  type SafetyStore,
} from "./safety-review";

export type IdentityDevice = {
  deviceId: string;
  deviceName: string;
  identityPublicKey: string;
  signingPublicKey: string;
};

export type IdentityMember = {
  userId: string;
  username: string;
  displayName: string | null;
  role: "ADMIN" | "MEMBER";
  devices: IdentityDevice[];
};

export type IdentityDirectory = {
  conversationId: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  complete: boolean;
  incompleteReason: "too_many_members" | "too_many_devices" | "unreadable_keys" | "not_direct" | null;
  members: IdentityMember[];
};

export type SafetyCardMember = {
  userId: string;
  name: string;
  username: string;
  you: boolean;
  deviceCount: number;
  deviceNames: string[];
  changed: boolean;
};

export type SafetyCard = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  username: string | null;
  status: SafetyStatus;
  groups: string[];
  qrPayload: string | null;
  digits: string | null;
  fingerprints: Record<string, string> | null;
  canVerify: boolean;
  canAccept: boolean;
  members: SafetyCardMember[];
};

export type SafetyView = {
  cards: SafetyCard[];
  store: SafetyStore;
  directories: IdentityDirectory[];
  local: LocalIdentity | null;
  localWarning: "mismatch" | "missing" | null;
  locked: boolean;
};

function peerOf(directory: IdentityDirectory, viewerUserId: string): IdentityMember | undefined {
  return directory.members.find((member) => member.userId !== viewerUserId);
}

function memberName(member: IdentityMember): string {
  const name = member.displayName?.trim();
  return name || member.username;
}

async function fingerprintMap(members: IdentityMember[]): Promise<Record<string, string>> {
  const entries = await Promise.all(members.map(async (member) => {
    const fingerprint = await accountFingerprint(member.userId, member.devices.map((device) => ({
      deviceId: device.deviceId,
      identityPublicKey: device.identityPublicKey,
      signingPublicKey: device.signingPublicKey,
    })));
    return [member.userId, bytesToHex(fingerprint)] as const;
  }));
  return Object.fromEntries(entries);
}

function toSafetyMembers(members: IdentityMember[]): SafetyMember[] {
  return members.map((member) => ({
    userId: member.userId,
    devices: member.devices.map((device) => ({
      deviceId: device.deviceId,
      identityPublicKey: device.identityPublicKey,
      signingPublicKey: device.signingPublicKey,
    })),
  }));
}

export async function buildSafetyView(input: {
  viewerUserId: string;
  local: LocalIdentity | null;
  directories: IdentityDirectory[];
  store: SafetyStore;
  now: string;
}): Promise<SafetyView> {
  let store = input.store;
  let localWarning: SafetyView["localWarning"] = null;
  const cards: SafetyCard[] = [];

  for (const directory of input.directories) {
    const you = directory.members.find((member) => member.userId === input.viewerUserId);
    const localStatus = directory.complete
      ? localDeviceStatus(input.local, you?.devices ?? [])
      : "unknown";
    if (localStatus === "mismatch") localWarning = "mismatch";
    else if (localStatus === "missing" && localWarning !== "mismatch") localWarning = "missing";

    const baseMembers = directory.members.map((member) => ({
      userId: member.userId,
      name: memberName(member),
      username: member.username,
      you: member.userId === input.viewerUserId,
      deviceCount: member.devices.length,
      deviceNames: member.devices.map((device) => device.deviceName).filter((name) => name.length > 0),
      changed: false,
    }));

    const peer = peerOf(directory, input.viewerUserId);
    const viewer = directory.members.find((member) => member.userId === input.viewerUserId);
    const pairReady = directory.type === "GROUP"
      ? Boolean(viewer) && directory.members.length >= 1 && directory.members.length <= 8
      : Boolean(viewer && peer) && directory.members.length === 2;
    if (!directory.complete || !pairReady) {
      cards.push({
        id: directory.conversationId,
        kind: directory.type === "GROUP" ? "group" : "direct",
        title: directory.type === "GROUP" ? directory.title : (peer ? memberName(peer) : null),
        username: directory.type === "DIRECT" ? peer?.username ?? null : null,
        status: "incomplete",
        groups: [],
        qrPayload: null,
        digits: null,
        fingerprints: null,
        canVerify: false,
        canAccept: false,
        members: baseMembers,
      });
      continue;
    }

    const fingerprints = await fingerprintMap(directory.members);
    const safety = directory.type === "GROUP"
      ? await groupSafetyNumber(toSafetyMembers(directory.members))
      : await directSafetyNumber(
          { userId: viewer!.userId, devices: toSafetyMembers([viewer!])[0]!.devices },
          { userId: peer!.userId, devices: toSafetyMembers([peer!])[0]!.devices },
        );
    const previous = store.conversations[directory.conversationId];
    store = observeSafety(store, directory.conversationId, safety.digits, fingerprints, input.now);
    const status = assessSafety(store.conversations[directory.conversationId], safety.digits, fingerprints);
    const blocked = localStatus === "mismatch" || localStatus === "missing";
    cards.push({
      id: directory.conversationId,
      kind: directory.type === "GROUP" ? "group" : "direct",
      title: directory.type === "GROUP" ? directory.title : (peer ? memberName(peer) : null),
      username: directory.type === "DIRECT" ? peer?.username ?? null : null,
      status,
      groups: safety.groups,
      qrPayload: safety.qrPayload,
      digits: safety.digits,
      fingerprints,
      canVerify: !blocked && status !== "verified",
      canAccept: !blocked && status === "key_changed",
      members: baseMembers.map((member) => ({
        ...member,
        changed: status === "key_changed" && previous?.fingerprints[member.userId] !== fingerprints[member.userId],
      })),
    });
  }

  return {
    cards,
    store,
    directories: input.directories,
    local: input.local,
    localWarning,
    locked: input.local === null,
  };
}

export async function reviewSafetyCard(
  view: SafetyView,
  conversationId: string,
  action: "verify" | "accept",
  now: string,
  local: LocalIdentity | null,
  viewerUserId: string,
): Promise<SafetyView> {
  const card = view.cards.find((item) => item.id === conversationId);
  if (!card?.digits || !card.fingerprints) return view;
  if (action === "verify" && !card.canVerify) return view;
  if (action === "accept" && !card.canAccept) return view;
  const store = action === "verify"
    ? markSafetyVerified(view.store, conversationId, card.digits, card.fingerprints, now)
    : acceptSafetyChange(view.store, conversationId, card.digits, card.fingerprints, now);
  return buildSafetyView({
    viewerUserId,
    local,
    directories: view.directories,
    store,
    now,
  });
}
