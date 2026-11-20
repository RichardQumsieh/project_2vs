import type {
  AuthenticationService,
  ClientConfig,
  ClientState,
  CiphersuiteImpl,
  Credential,
  IncomingMessageCallback,
  KeyPackage,
  MLSMessage,
  PrivateKeyPackage,
  Proposal,
} from "ts-mls";
import { createCommit } from "ts-mls/createCommit.js";
import { createApplicationMessage, createProposal } from "ts-mls/createMessage.js";
import { createGroup, decodeGroupState, encodeGroupState, getOwnLeafNode, joinGroup } from "ts-mls/clientState.js";
import { signWithLabel } from "ts-mls/crypto/signature.js";
import { encodeLeafNodeTBS } from "ts-mls/leafNode.js";
import { updateLeafKey } from "ts-mls/privateKeyPath.js";
import type { ProposalWithSender } from "ts-mls/unappliedProposals.js";
import { getCiphersuiteFromName } from "ts-mls/crypto/ciphersuite.js";
import { getCiphersuiteImpl } from "ts-mls/crypto/getCiphersuiteImpl.js";
import { defaultCapabilities } from "ts-mls/defaultCapabilities.js";
import { generateKeyPackage } from "ts-mls/keyPackage.js";
import { defaultKeyPackageEqualityConfig } from "ts-mls/keyPackageEqualityConfig.js";
import { defaultKeyRetentionConfig } from "ts-mls/keyRetentionConfig.js";
import { defaultLifetime } from "ts-mls/lifetime.js";
import { defaultLifetimeConfig } from "ts-mls/lifetimeConfig.js";
import { decodeMlsMessage, encodeMlsMessage } from "ts-mls/message.js";
import { defaultPaddingConfig } from "ts-mls/paddingConfig.js";
import { processMessage } from "ts-mls/processMessages.js";
import { emptyPskIndex } from "ts-mls/pskIndex.js";
import { zeroOutUint8Array } from "ts-mls/util/byteArray.js";
import { b64ToBytes, bytesToB64, bytesToUtf8, equalBytes, utf8ToBytes } from "./bytes";
import { signBytes, verifyBytes } from "./keys";

/**
 * Small-group E2EE using MLS (RFC 9420) via ts-mls 1.6.4.
 *
 * Cipher suite MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 matches the
 * algorithms already used for 1:1 (X25519, AES-GCM, SHA-256, Ed25519).
 * Application messages do not use the 1:1 Double Ratchet. Each device's
 * existing Ed25519 signing key binds the MLS key package before anyone
 * will commit an Add.
 *
 * The server is expected to store the returned wire bytes and nothing else.
 * Private key packages and ClientState stay on the device.
 */

export const GROUP_E2EE_MAX_USERS = 8;
export const GROUP_E2EE_MAX_DEVICES_PER_USER = 2;
const IDENTITY_PREFIX = "sophia-mls/v1";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class GroupCryptoError extends Error {
  readonly code:
    | "cannot_decrypt"
    | "not_member"
    | "rejected"
    | "invalid";

  constructor(
    message: string,
    code: GroupCryptoError["code"],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GroupCryptoError";
    this.code = code;
  }
}

export type DeviceRef = {
  userId: string;
  deviceId: string;
};

export type GroupRole = "admin" | "member";

export type RosterLeaf = DeviceRef & { role: GroupRole };

export type GroupDevice = {
  ref: DeviceRef;
  role: GroupRole;
  sophiaSigningPublicKey: Uint8Array;
  /** Public MLS key package. Safe to upload. */
  keyPackageWire: Uint8Array;
  /** Ed25519 signature of keyPackageWire by the device signing key. */
  bindingSignature: Uint8Array;
  publicPackage: KeyPackage;
  /** Never upload this. */
  privatePackage: PrivateKeyPackage;
};

export type PublishedKeyPackage = {
  userId: string;
  deviceId: string;
  keyPackageB64: string;
  bindingSignatureB64: string;
};

export type GroupSession = {
  device: GroupDevice;
  state: ClientState;
  trustedKeyPackages: ReadonlySet<string>;
};

let suitePromise: Promise<CiphersuiteImpl> | null = null;

async function cipherSuite(): Promise<CiphersuiteImpl> {
  suitePromise ??= getCiphersuiteImpl(
    getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
  ).catch((error: unknown) => {
    suitePromise = null;
    throw error;
  });
  return suitePromise;
}

const authService: AuthenticationService = {
  async validateCredential(credential) {
    return deviceRefFromCredential(credential) !== null;
  },
};

const clientConfig: ClientConfig = {
  keyRetentionConfig: defaultKeyRetentionConfig,
  lifetimeConfig: defaultLifetimeConfig,
  keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
  paddingConfig: defaultPaddingConfig,
  authService,
};

function normalizeRef(ref: DeviceRef): DeviceRef {
  const userId = ref.userId.toLowerCase();
  const deviceId = ref.deviceId.toLowerCase();
  if (!UUID_RE.test(userId) || !UUID_RE.test(deviceId)) {
    throw new GroupCryptoError("Device identity must be two UUIDs", "invalid");
  }
  return { userId, deviceId };
}

function formatIdentity(ref: DeviceRef, role: GroupRole): string {
  return `${IDENTITY_PREFIX}:${ref.userId}:${ref.deviceId}:${role}`;
}

export function deviceRefFromIdentity(identity: Uint8Array): RosterLeaf | null {
  let text: string;
  try {
    text = bytesToUtf8(identity);
  } catch {
    return null;
  }
  const parts = text.split(":");
  if (parts.length !== 4 || parts[0] !== IDENTITY_PREFIX) return null;
  const userId = parts[1]?.toLowerCase() ?? "";
  const deviceId = parts[2]?.toLowerCase() ?? "";
  const role = parts[3];
  if (!UUID_RE.test(userId) || !UUID_RE.test(deviceId)) return null;
  if (role !== "admin" && role !== "member") return null;
  return { userId, deviceId, role };
}

function deviceRefFromCredential(credential: Credential): RosterLeaf | null {
  if (credential.credentialType !== "basic") return null;
  return deviceRefFromIdentity(credential.identity);
}

function requireCredential(credential: Credential): RosterLeaf {
  const ref = deviceRefFromCredential(credential);
  if (!ref) {
    throw new GroupCryptoError("MLS credential is not a Sophia device identity", "invalid");
  }
  return ref;
}

function sameRef(left: DeviceRef, right: DeviceRef): boolean {
  return left.userId === right.userId && left.deviceId === right.deviceId;
}

function fingerprintKeyPackage(keyPackage: KeyPackage): string {
  const ref = requireCredential(keyPackage.leafNode.credential);
  return [
    formatIdentity(ref, ref.role),
    bytesToB64(keyPackage.initKey),
    bytesToB64(keyPackage.leafNode.signaturePublicKey),
    bytesToB64(keyPackage.leafNode.hpkePublicKey),
    bytesToB64(keyPackage.signature),
  ].join(".");
}

function decodeWire(bytes: Uint8Array): MLSMessage {
  const decoded = decodeMlsMessage(bytes, 0);
  if (!decoded) {
    throw new GroupCryptoError("Malformed MLS message", "invalid");
  }
  const [message, read] = decoded;
  if (read !== bytes.length) {
    throw new GroupCryptoError("Malformed MLS message", "invalid");
  }
  return message;
}

function wipe(consumed: Uint8Array[]) {
  for (const secret of consumed) zeroOutUint8Array(secret);
}

function withTrust(session: GroupSession, trusted: ReadonlySet<string>, state: ClientState): GroupSession {
  return { device: session.device, state, trustedKeyPackages: trusted };
}

/**
 * ts-mls mutates epoch secrets while a commit is decoded. A rejected or
 * failed commit must leave the caller's previous state usable.
 */
function isolateState(state: ClientState): ClientState {
  const { clientConfig: config, ...rest } = state;
  const cloned = structuredClone(rest);
  return { ...cloned, clientConfig: config };
}

export function assertMembershipCapacity(members: readonly DeviceRef[], adding: DeviceRef): void {
  const next = normalizeRef(adding);
  if (members.some((member) => member.deviceId === next.deviceId)) {
    throw new GroupCryptoError("That device is already in the group", "invalid");
  }
  const users = new Set(members.map((member) => member.userId));
  if (!users.has(next.userId) && users.size >= GROUP_E2EE_MAX_USERS) {
    throw new GroupCryptoError("Groups are limited to 8 members", "invalid");
  }
  const devicesForUser = members.filter((member) => member.userId === next.userId).length;
  if (devicesForUser >= GROUP_E2EE_MAX_DEVICES_PER_USER) {
    throw new GroupCryptoError(
      "Each member is limited to 2 devices in this prototype",
      "invalid",
    );
  }
}

export function listRoster(session: GroupSession): RosterLeaf[] {
  return rosterFromState(session.state);
}

export function listMembers(session: GroupSession): DeviceRef[] {
  return listRoster(session).map(({ userId, deviceId }) => ({ userId, deviceId }));
}

export function hasPendingProposals(session: GroupSession): boolean {
  return Object.keys(session.state.unappliedProposals).length > 0;
}

function rosterFromState(state: ClientState): RosterLeaf[] {
  const members: RosterLeaf[] = [];
  state.ratchetTree.forEach((node, nodeIndex) => {
    if (!node || node.nodeType !== "leaf" || nodeIndex % 2 !== 0) return;
    members.push(requireCredential(node.leaf.credential));
  });
  return members;
}

function leafAt(state: ClientState, leafIndex: number): RosterLeaf | null {
  const node = state.ratchetTree[leafIndex * 2];
  if (!node || node.nodeType !== "leaf") return null;
  return deviceRefFromCredential(node.leaf.credential);
}

function assertAdmin(session: GroupSession): void {
  const self = listRoster(session).find((leaf) => leaf.deviceId === session.device.ref.deviceId);
  if (!self || self.role !== "admin") {
    throw new GroupCryptoError("Only a group admin can change membership", "rejected");
  }
}

export function groupEpoch(session: GroupSession): number {
  return Number(session.state.groupContext.epoch);
}

function membersEqual(actual: readonly DeviceRef[], expected: readonly DeviceRef[]): boolean {
  if (actual.length !== expected.length) return false;
  const keys = new Set(expected.map((ref) => `${ref.userId}:${ref.deviceId}`));
  return actual.every((ref) => keys.has(`${ref.userId}:${ref.deviceId}`));
}

function isSelfRemovalEntry(
  state: ClientState,
  entry: { proposal: Proposal; senderLeafIndex: number | undefined },
): boolean {
  if (entry.proposal.proposalType !== "remove" || entry.senderLeafIndex === undefined) return false;
  const sender = leafAt(state, entry.senderLeafIndex);
  const target = leafAt(state, entry.proposal.remove.removed);
  return Boolean(sender && target && sender.deviceId === target.deviceId);
}

function roleChangeOf(
  state: ClientState,
  entry: { proposal: Proposal; senderLeafIndex: number | undefined },
): { deviceId: string; role: GroupRole } | null {
  if (entry.proposal.proposalType !== "update" || entry.senderLeafIndex === undefined) return null;
  const current = leafAt(state, entry.senderLeafIndex);
  const next = deviceRefFromCredential(entry.proposal.update.leafNode.credential);
  if (!current || !next || !sameRef(current, next) || current.role === next.role) return null;
  return { deviceId: next.deviceId, role: next.role };
}

function leafIndexFor(state: ClientState, deviceId: string): number {
  const matches: number[] = [];
  state.ratchetTree.forEach((node, nodeIndex) => {
    if (!node || node.nodeType !== "leaf" || nodeIndex % 2 !== 0) return;
    const ref = deviceRefFromCredential(node.leaf.credential);
    if (ref?.deviceId === deviceId) matches.push(nodeIndex / 2);
  });
  if (matches.length !== 1) {
    throw new GroupCryptoError("That device is not a current group member", "invalid");
  }
  return matches[0]!;
}

function acceptIncoming(state: ClientState, trusted: ReadonlySet<string>): IncomingMessageCallback {
  return (incoming) => {
    const proposals = incoming.kind === "commit" ? incoming.proposals : [incoming.proposal];
    const committer = incoming.kind === "commit" && incoming.senderLeafIndex !== undefined
      ? leafAt(state, incoming.senderLeafIndex)
      : null;
    const roleChanges = proposals.filter((item) => roleChangeOf(state, item) !== null);
    const adminMembership = proposals.some((item) =>
      item.proposal.proposalType === "add" ||
      (item.proposal.proposalType === "remove" && !isSelfRemovalEntry(state, item)),
    );
    if (incoming.kind === "commit" && (adminMembership || roleChanges.length > 0) && committer?.role !== "admin") {
      return "reject";
    }
    for (const item of proposals) {
      const proposal = item.proposal;
      const sender = item.senderLeafIndex !== undefined
        ? leafAt(state, item.senderLeafIndex)
        : committer;
      if (proposal.proposalType === "remove") {
        const target = leafAt(state, proposal.remove.removed);
        const selfRemove = Boolean(sender && target && sender.deviceId === target.deviceId);
        if (!selfRemove && sender?.role !== "admin") return "reject";
        continue;
      }
      if (proposal.proposalType === "add") {
        if (sender?.role !== "admin") return "reject";
        let fingerprint: string;
        let added: RosterLeaf;
        try {
          fingerprint = fingerprintKeyPackage(proposal.add.keyPackage);
          added = requireCredential(proposal.add.keyPackage.leafNode.credential);
        } catch {
          return "reject";
        }
        if (!trusted.has(fingerprint)) return "reject";
        const existing = rosterFromState(state).find((leaf) => leaf.userId === added.userId);
        if (existing && existing.role !== added.role) return "reject";
        continue;
      }
      if (proposal.proposalType === "update") {
        const senderIndex = item.senderLeafIndex;
        if (senderIndex === undefined) return "reject";
        const current = leafAt(state, senderIndex);
        const next = deviceRefFromCredential(proposal.update.leafNode.credential);
        if (!current || !next || !sameRef(current, next)) return "reject";
        if (
          current.role !== next.role &&
          incoming.kind === "commit" &&
          (committer?.role !== "admin" || committer.deviceId === current.deviceId)
        ) {
          return "reject";
        }
        continue;
      }
      return "reject";
    }
    return "accept";
  };
}

async function verifiedKeyPackage(
  published: PublishedKeyPackage,
  sophiaSigningPublicKey: Uint8Array,
): Promise<{ keyPackage: KeyPackage; fingerprint: string; ref: RosterLeaf }> {
  const ref = normalizeRef({ userId: published.userId, deviceId: published.deviceId });
  if (sophiaSigningPublicKey.byteLength !== 32) {
    throw new GroupCryptoError("Device signing key is not an Ed25519 public key", "invalid");
  }
  const wire = b64ToBytes(published.keyPackageB64);
  const signature = b64ToBytes(published.bindingSignatureB64);
  if (signature.byteLength !== 64) {
    throw new GroupCryptoError("Key package binding signature is invalid", "invalid");
  }
  const signed = await verifyBytes(sophiaSigningPublicKey, signature, wire);
  if (!signed) {
    throw new GroupCryptoError(
      "Key package is not signed by the device's Ed25519 signing key",
      "invalid",
    );
  }
  const message = decodeWire(wire);
  if (message.wireformat !== "mls_key_package") {
    throw new GroupCryptoError("Expected an MLS key package", "invalid");
  }
  const claimed = requireCredential(message.keyPackage.leafNode.credential);
  if (!sameRef(claimed, ref)) {
    throw new GroupCryptoError(
      "Key package identity does not match the device that signed it",
      "invalid",
    );
  }
  return {
    keyPackage: message.keyPackage,
    fingerprint: fingerprintKeyPackage(message.keyPackage),
    ref: claimed,
  };
}

export async function createGroupDevice(input: {
  userId: string;
  deviceId: string;
  role?: GroupRole;
  sophiaSigningPrivateJwk: JsonWebKey;
  sophiaSigningPublicKey: Uint8Array;
}): Promise<GroupDevice> {
  const ref = normalizeRef({ userId: input.userId, deviceId: input.deviceId });
  const role = input.role ?? "member";
  if (input.sophiaSigningPublicKey.byteLength !== 32) {
    throw new GroupCryptoError("Device signing key is not an Ed25519 public key", "invalid");
  }
  const suite = await cipherSuite();
  const credential: Credential = {
    credentialType: "basic",
    identity: utf8ToBytes(formatIdentity(ref, role)),
  };
  const generated = await generateKeyPackage(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [],
    suite,
  );
  const keyPackageWire = encodeMlsMessage({
    version: "mls10",
    wireformat: "mls_key_package",
    keyPackage: generated.publicPackage,
  });
  const bindingSignature = await signBytes(input.sophiaSigningPrivateJwk, keyPackageWire);
  const roundTrip = await verifyBytes(
    input.sophiaSigningPublicKey,
    bindingSignature,
    keyPackageWire,
  );
  if (!roundTrip) {
    throw new GroupCryptoError("Could not bind the key package to the device key", "invalid");
  }
  return {
    ref,
    role,
    sophiaSigningPublicKey: input.sophiaSigningPublicKey,
    keyPackageWire,
    bindingSignature,
    publicPackage: generated.publicPackage,
    privatePackage: generated.privatePackage,
  };
}

export function publishedKeyPackage(device: GroupDevice): PublishedKeyPackage {
  return {
    userId: device.ref.userId,
    deviceId: device.ref.deviceId,
    keyPackageB64: bytesToB64(device.keyPackageWire),
    bindingSignatureB64: bytesToB64(device.bindingSignature),
  };
}

export async function createGroupSession(
  device: GroupDevice,
  groupId: string,
): Promise<GroupSession> {
  if (device.role !== "admin") {
    throw new GroupCryptoError("The group creator's device must be an admin leaf", "invalid");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(groupId)) {
    throw new GroupCryptoError("Group id must be 1-64 URL-safe characters", "invalid");
  }
  const suite = await cipherSuite();
  const state = await createGroup(
    utf8ToBytes(groupId),
    device.publicPackage,
    device.privatePackage,
    [],
    suite,
    clientConfig,
  );
  const session = { device, state, trustedKeyPackages: new Set<string>() };
  const members = listMembers(session);
  if (members.length !== 1 || !sameRef(members[0]!, device.ref)) {
    throw new GroupCryptoError("New group did not contain only its creator", "invalid");
  }
  return session;
}

export async function trustKeyPackage(
  session: GroupSession,
  published: PublishedKeyPackage,
  sophiaSigningPublicKey: Uint8Array,
): Promise<GroupSession> {
  const verified = await verifiedKeyPackage(published, sophiaSigningPublicKey);
  const trusted = new Set(session.trustedKeyPackages);
  trusted.add(verified.fingerprint);
  return { ...session, trustedKeyPackages: trusted };
}

export async function addDevice(
  session: GroupSession,
  published: PublishedKeyPackage,
  sophiaSigningPublicKey: Uint8Array,
  options?: { enforceAdmin?: boolean },
): Promise<{ session: GroupSession; commit: Uint8Array; welcome: Uint8Array }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  if (options?.enforceAdmin !== false) assertAdmin(session);
  const verified = await verifiedKeyPackage(published, sophiaSigningPublicKey);
  const existingUser = listRoster(session).find((leaf) => leaf.userId === verified.ref.userId);
  if (existingUser && existingUser.role !== verified.ref.role) {
    throw new GroupCryptoError("A member's devices must share one group role", "invalid");
  }
  assertMembershipCapacity(listMembers(session), verified.ref);
  const proposal: Proposal = {
    proposalType: "add",
    add: { keyPackage: verified.keyPackage },
  };
  const suite = await cipherSuite();
  const committed = await createCommit(
    { state: isolateState(session.state), cipherSuite: suite, pskIndex: emptyPskIndex },
    { extraProposals: [proposal], ratchetTreeExtension: true },
  );
  wipe(committed.consumed);
  if (!committed.welcome) {
    throw new GroupCryptoError("MLS did not produce a Welcome for the new device", "invalid");
  }
  const trusted = new Set(session.trustedKeyPackages);
  trusted.add(verified.fingerprint);
  const next = withTrust(session, trusted, committed.newState);
  const members = listMembers(next);
  if (!members.some((member) => sameRef(member, verified.ref))) {
    throw new GroupCryptoError("The new device is missing from the committed group", "invalid");
  }
  return {
    session: next,
    commit: encodeMlsMessage(committed.commit),
    welcome: encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_welcome",
      welcome: committed.welcome,
    }),
  };
}

export async function joinFromWelcome(
  device: GroupDevice,
  welcomeWire: Uint8Array,
  expectedMembers?: readonly DeviceRef[],
): Promise<GroupSession> {
  const message = decodeWire(welcomeWire);
  if (message.wireformat !== "mls_welcome") {
    throw new GroupCryptoError("Expected an MLS Welcome", "invalid");
  }
  const suite = await cipherSuite();
  const state = await joinGroup(
    message.welcome,
    device.publicPackage,
    device.privatePackage,
    emptyPskIndex,
    suite,
    undefined,
    undefined,
    clientConfig,
  );
  const session: GroupSession = {
    device,
    state,
    trustedKeyPackages: new Set<string>(),
  };
  const actual = listMembers(session);
  if (!actual.some((member) => sameRef(member, device.ref))) {
    throw new GroupCryptoError("Welcome did not include this device", "invalid");
  }
  if (expectedMembers) {
    const expected = expectedMembers.map((ref) => normalizeRef(ref));
    if (!membersEqual(actual, expected)) {
      throw new GroupCryptoError(
        "Welcome group members did not match the expected device list",
        "invalid",
      );
    }
  }
  return session;
}

export async function removeDevice(
  session: GroupSession,
  deviceId: string,
  options?: { enforceAdmin?: boolean },
): Promise<{ session: GroupSession; commit: Uint8Array }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  if (options?.enforceAdmin !== false) assertAdmin(session);
  const targetId = deviceId.toLowerCase();
  if (targetId === session.device.ref.deviceId) {
    throw new GroupCryptoError("Another member has to remove this device", "invalid");
  }
  const proposal: Proposal = {
    proposalType: "remove",
    remove: { removed: leafIndexFor(session.state, targetId) },
  };
  const suite = await cipherSuite();
  const committed = await createCommit(
    { state: isolateState(session.state), cipherSuite: suite, pskIndex: emptyPskIndex },
    { extraProposals: [proposal], ratchetTreeExtension: true },
  );
  wipe(committed.consumed);
  const next = withTrust(session, new Set(session.trustedKeyPackages), committed.newState);
  if (listMembers(next).some((member) => member.deviceId === targetId)) {
    throw new GroupCryptoError("The device is still in the group after removal", "invalid");
  }
  return { session: next, commit: encodeMlsMessage(committed.commit) };
}

export async function applyCommit(
  session: GroupSession,
  commitWire: Uint8Array,
): Promise<{ session: GroupSession; selfRemoved: boolean }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  const message = decodeWire(commitWire);
  if (
    message.wireformat !== "mls_private_message" &&
    message.wireformat !== "mls_public_message"
  ) {
    throw new GroupCryptoError("Expected an MLS commit", "invalid");
  }
  const suite = await cipherSuite();
  let processed;
  try {
    processed = await processMessage(
      message,
      isolateState(session.state),
      emptyPskIndex,
      acceptIncoming(session.state, session.trustedKeyPackages),
      suite,
    );
  } catch (error) {
    throw new GroupCryptoError("Could not apply the group commit", "cannot_decrypt", {
      cause: error,
    });
  }
  wipe(processed.consumed);
  if (processed.kind !== "newState") {
    throw new GroupCryptoError("Expected a commit, received an application message", "invalid");
  }
  if (processed.actionTaken === "reject") {
    throw new GroupCryptoError(
      "The commit was rejected because it adds an unbound key package or changes a device identity",
      "rejected",
    );
  }
  const selfRemoved = processed.newState.groupActiveState.kind === "removedFromGroup";
  return {
    session: withTrust(session, new Set(session.trustedKeyPackages), processed.newState),
    selfRemoved,
  };
}

export async function sealMessage(
  session: GroupSession,
  plaintext: string,
): Promise<{ session: GroupSession; message: Uint8Array }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  if (plaintext.length === 0 || plaintext.length > 16_000) {
    throw new GroupCryptoError("Group message must be 1 to 16000 characters", "invalid");
  }
  const suite = await cipherSuite();
  const sealed = await createApplicationMessage(
    isolateState(session.state),
    utf8ToBytes(plaintext),
    suite,
  );
  wipe(sealed.consumed);
  return {
    session: withTrust(session, new Set(session.trustedKeyPackages), sealed.newState),
    message: encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_private_message",
      privateMessage: sealed.privateMessage,
    }),
  };
}

export async function openMessage(
  session: GroupSession,
  messageWire: Uint8Array,
): Promise<{ session: GroupSession; plaintext: string }> {
  if (session.state.groupActiveState.kind === "removedFromGroup") {
    throw new GroupCryptoError(
      "This device was removed and cannot decrypt new group messages",
      "not_member",
    );
  }
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  const message = decodeWire(messageWire);
  if (message.wireformat !== "mls_private_message") {
    throw new GroupCryptoError("Expected an MLS private message", "invalid");
  }
  const suite = await cipherSuite();
  let opened;
  try {
    opened = await processMessage(
      message,
      isolateState(session.state),
      emptyPskIndex,
      acceptIncoming(session.state, session.trustedKeyPackages),
      suite,
    );
  } catch (error) {
    throw new GroupCryptoError("Could not decrypt the group message", "cannot_decrypt", {
      cause: error,
    });
  }
  wipe(opened.consumed);
  if (opened.kind !== "applicationMessage") {
    throw new GroupCryptoError("Expected an application message", "invalid");
  }
  return {
    session: withTrust(session, new Set(session.trustedKeyPackages), opened.newState),
    plaintext: bytesToUtf8(opened.message),
  };
}

export async function proposeSelfRemoval(
  session: GroupSession,
): Promise<{ session: GroupSession; proposal: Uint8Array }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  const proposal: Proposal = {
    proposalType: "remove",
    remove: { removed: leafIndexFor(session.state, session.device.ref.deviceId) },
  };
  const suite = await cipherSuite();
  const created = await createProposal(isolateState(session.state), false, proposal, suite);
  wipe(created.consumed);
  return {
    session: withTrust(session, new Set(session.trustedKeyPackages), created.newState),
    proposal: encodeMlsMessage(created.message),
  };
}

/**
 * An Update signed by this leaf that changes only admin|member.
 * Another admin has to commit it. ts-mls rejects a commit that contains the
 * committer's own update, so a member cannot promote themselves.
 */
export async function proposeRoleUpdate(
  session: GroupSession,
  role: GroupRole,
): Promise<{ session: GroupSession; proposal: Uint8Array; leafPublicKey: Uint8Array; leafPrivateKey: Uint8Array }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  const current = listRoster(session).find((leaf) => leaf.deviceId === session.device.ref.deviceId);
  if (!current || current.role === role) {
    throw new GroupCryptoError("This device already has that group role", "invalid");
  }
  const own = getOwnLeafNode(session.state);
  const suite = await cipherSuite();
  const hpke = await suite.hpke.generateKeyPair();
  const leafPublicKey = new Uint8Array(await suite.hpke.exportPublicKey(hpke.publicKey));
  const leafPrivateKey = new Uint8Array(await suite.hpke.exportPrivateKey(hpke.privateKey));
  const tbs = {
    hpkePublicKey: leafPublicKey,
    signaturePublicKey: own.signaturePublicKey,
    credential: {
      credentialType: "basic" as const,
      identity: utf8ToBytes(formatIdentity(session.device.ref, role)),
    },
    capabilities: own.capabilities,
    leafNodeSource: "update" as const,
    extensions: own.extensions,
    groupId: session.state.groupContext.groupId,
    leafIndex: session.state.privatePath.leafIndex,
  };
  const signature = await signWithLabel(
    session.state.signaturePrivateKey,
    "LeafNodeTBS",
    encodeLeafNodeTBS(tbs),
    suite.signature,
  );
  const proposal: Proposal = {
    proposalType: "update",
    update: {
      leafNode: {
        hpkePublicKey: leafPublicKey,
        signaturePublicKey: own.signaturePublicKey,
        credential: tbs.credential,
        capabilities: own.capabilities,
        leafNodeSource: "update",
        extensions: own.extensions,
        signature,
      },
    },
  };
  const created = await createProposal(isolateState(session.state), false, proposal, suite);
  wipe(created.consumed);
  return {
    session: withTrust(session, new Set(session.trustedKeyPackages), created.newState),
    proposal: encodeMlsMessage(created.message),
    leafPublicKey,
    leafPrivateKey,
  };
}

export function ownLeafPublicKey(session: GroupSession): Uint8Array {
  return getOwnLeafNode(session.state).hpkePublicKey;
}

/** Install the private key for an Update this device proposed, before applying the commit that publishes it. */
export function withLeafPrivateKey(session: GroupSession, leafPrivateKey: Uint8Array): GroupSession {
  const state = isolateState(session.state);
  state.privatePath = updateLeafKey(state.privatePath, leafPrivateKey);
  return withTrust(session, new Set(session.trustedKeyPackages), state);
}

/**
 * Commit proposals already accepted into this epoch.
 * An admin commits membership and role changes. Any other member may commit
 * only self-removal proposals, which is how a leave finishes while every admin
 * is offline. ts-mls rejects a commit that removes the committer.
 */
export async function commitPending(
  session: GroupSession,
  options?: {
    selfRemovalsOnly?: boolean;
    directoryRoles?: ReadonlyMap<string, GroupRole>;
  },
): Promise<{ session: GroupSession; commit: Uint8Array; welcome?: Uint8Array }> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  if (!options?.selfRemovalsOnly) assertAdmin(session);
  const filtered = isolateState(session.state);
  const kept: Record<string, ProposalWithSender> = {};
  const selfLeaf = filtered.privatePath.leafIndex;
  for (const [key, entry] of Object.entries(filtered.unappliedProposals)) {
    if (options?.selfRemovalsOnly) {
      if (isSelfRemovalEntry(session.state, entry)) kept[key] = entry;
      continue;
    }
    if (entry.proposal.proposalType === "update" && entry.senderLeafIndex === selfLeaf) continue;
    const roleChange = roleChangeOf(session.state, entry);
    if (roleChange && options?.directoryRoles) {
      if (options.directoryRoles.get(roleChange.deviceId) !== roleChange.role) continue;
    }
    kept[key] = entry;
  }
  filtered.unappliedProposals = kept;
  if (Object.keys(kept).length === 0) {
    throw new GroupCryptoError("There is no pending group proposal to commit", "invalid");
  }
  const suite = await cipherSuite();
  let committed;
  try {
    committed = await createCommit(
      { state: filtered, cipherSuite: suite, pskIndex: emptyPskIndex },
      { ratchetTreeExtension: true },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("removing committer")) {
      throw new GroupCryptoError("An admin cannot commit their own removal", "invalid", {
        cause: error,
      });
    }
    throw new GroupCryptoError("Could not commit the pending proposal", "invalid", { cause: error });
  }
  wipe(committed.consumed);
  const next = withTrust(session, new Set(session.trustedKeyPackages), committed.newState);
  return {
    session: next,
    commit: encodeMlsMessage(committed.commit),
    ...(committed.welcome
      ? {
          welcome: encodeMlsMessage({
            version: "mls10",
            wireformat: "mls_welcome",
            welcome: committed.welcome,
          }),
        }
      : {}),
  };
}

export async function applyProposal(
  session: GroupSession,
  proposalWire: Uint8Array,
): Promise<GroupSession> {
  if (session.state.groupActiveState.kind !== "active") {
    throw new GroupCryptoError("This device is not an active group member", "not_member");
  }
  const before = groupEpoch(session);
  const message = decodeWire(proposalWire);
  if (message.wireformat !== "mls_private_message" && message.wireformat !== "mls_public_message") {
    throw new GroupCryptoError("Expected an MLS proposal", "invalid");
  }
  const suite = await cipherSuite();
  let processed;
  try {
    processed = await processMessage(
      message,
      isolateState(session.state),
      emptyPskIndex,
      acceptIncoming(session.state, session.trustedKeyPackages),
      suite,
    );
  } catch (error) {
    throw new GroupCryptoError("Could not apply the group proposal", "cannot_decrypt", {
      cause: error,
    });
  }
  wipe(processed.consumed);
  if (processed.kind !== "newState") {
    throw new GroupCryptoError("Expected a proposal, received an application message", "invalid");
  }
  if (processed.actionTaken === "reject") {
    throw new GroupCryptoError("The proposal was rejected by group policy", "rejected");
  }
  const next = withTrust(session, new Set(session.trustedKeyPackages), processed.newState);
  if (groupEpoch(next) !== before) {
    throw new GroupCryptoError("Expected a proposal, received a commit", "invalid");
  }
  return next;
}

export function encodeSessionState(session: GroupSession): Uint8Array {
  const { clientConfig, ...rest } = session.state;
  void clientConfig;
  return encodeGroupState(rest);
}

export function sessionFromEncodedState(
  device: GroupDevice,
  encoded: Uint8Array,
  trusted: readonly string[],
): GroupSession {
  const decoded = decodeGroupState(encoded, 0);
  if (!decoded || decoded[1] !== encoded.length) {
    throw new GroupCryptoError("Stored group state is malformed", "invalid");
  }
  return {
    device,
    state: { ...decoded[0], clientConfig },
    trustedKeyPackages: new Set(trusted),
  };
}

export function wireContainsPlaintext(wire: Uint8Array, plaintext: string): boolean {
  const secret = utf8ToBytes(plaintext);
  if (secret.length === 0 || secret.length > wire.length) return false;
  for (let offset = 0; offset <= wire.length - secret.length; offset += 1) {
    if (equalBytes(wire.subarray(offset, offset + secret.length), secret)) return true;
  }
  return false;
}
