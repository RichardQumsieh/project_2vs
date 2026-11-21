import { api } from "@/lib/api";
import {
  commitAppearance,
  loadAppearance,
  saveAppearance,
  activeRevision,
} from "@/lib/appearance/store";
import {
  defaultTokens,
  eveningTokens,
  familyTokens,
  morningTokens,
} from "@/lib/appearance/tokens";
import type { AppearanceTokens } from "@/lib/appearance/schema";
import { encodeFilePayload } from "@/lib/chat-payload";
import { inspectAndEncryptFileAttachment } from "@/lib/crypto/file-attachment";
import { readSafetyStore } from "@/lib/crypto/safety-store";
import { applyDocumentLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/i18n/locale";
import { encryptOutgoing, currentUserId, isUnlocked, storeSentMessage } from "@/lib/session";
import type { UndoAction, ValidatedToolCall } from "../../../backend/src/agent-control";

const themes: Record<string, AppearanceTokens> = {
  night: eveningTokens,
  day: morningTokens,
  paper: familyTokens,
  system: defaultTokens,
};

const themeKey = (userId: string) => `sophia-agent-theme:${userId}`;

export type AgentExecutor = {
  execute: (
    call: ValidatedToolCall,
    ctx: { autoApproveWrite: boolean },
  ) => Promise<{
    ok: boolean;
    summary: string;
    display?: string;
    before?: Record<string, unknown>;
    output?: Record<string, unknown>;
  }>;
  applyUndo: (action: UndoAction) => Promise<{ ok: boolean; summary: string }>;
};

export function createBrowserExecutor(input: {
  getFile: () => File | null;
  writesEnabled: () => boolean;
  onLocale?: (locale: Locale) => void;
}): AgentExecutor {
  const executor: AgentExecutor = {
    async execute(call, ctx) {
      try {
        return await runTool(call, ctx, input, executor);
      } catch (error) {
        return {
          ok: false,
          summary: error instanceof Error ? error.message : "The action failed.",
        };
      }
    },
    async applyUndo(action) {
      if (action.kind === "delete_for_everyone") {
        await api.deleteMessage(action.conversationId, action.messageId);
        return { ok: true, summary: "Deleted that message for everyone in the chat." };
      }
      const validated: ValidatedToolCall = {
        id: "undo",
        name: action.name,
        args: action.args,
      };
      const result = await executor.execute(validated, {
        autoApproveWrite: input.writesEnabled(),
      });
      return { ok: result.ok, summary: result.ok ? `Undone. ${result.summary}` : result.summary };
    },
  };
  return executor;
}

async function runTool(
  call: ValidatedToolCall,
  ctx: { autoApproveWrite: boolean },
  input: {
    getFile: () => File | null;
    writesEnabled: () => boolean;
    onLocale?: (locale: Locale) => void;
  },
  _executor: AgentExecutor,
) {
  const args = call.args;
  switch (call.name) {
    case "chat_create":
      return createChat(args);
    case "chat_send":
      return sendChat(String(args.conversationId), String(args.body));
    case "chat_rename":
      return renameChat(String(args.conversationId), String(args.title));
    case "chat_add_member":
      return changeMember(String(args.conversationId), String(args.username), "add");
    case "chat_remove_member":
      return changeMember(String(args.conversationId), String(args.username), "remove");
    case "chat_promote":
      return changeRole(String(args.conversationId), String(args.username), "ADMIN");
    case "chat_demote":
      return changeRole(String(args.conversationId), String(args.username), "MEMBER");
    case "chat_leave":
      return leaveChat(String(args.conversationId));
    case "file_list":
      return listFiles(input.getFile());
    case "file_stage":
      return stageFile(String(args.conversationId), String(args.filename), input.getFile());
    case "appearance_set_theme":
      return setTheme(String(args.theme));
    case "appearance_set_density":
      return setDensity(String(args.density) as "compact" | "comfortable" | "spacious");
    case "draft_voice_set":
      return setVoice(args);
    case "settings_update":
      return updateSetting(String(args.key), String(args.value), input.onLocale);
    case "safety_numbers_status":
      return safetyStatus(String(args.conversationId));
    case "workspace_create":
      return createWorkspace(String(args.name), args.kind === "TEAM" ? "TEAM" : "FAMILY");
    case "workspace_invite":
      return inviteWorkspace(String(args.workspaceId));
    case "workspace_revoke_invite":
      return revokeInvite(String(args.workspaceId), String(args.inviteId));
    case "workspace_set_role":
      return setWorkspaceRole(String(args.workspaceId), String(args.userId), args.role === "ADMIN" ? "ADMIN" : "MEMBER");
    case "workspace_remove_member":
      return removeWorkspaceMember(String(args.workspaceId), String(args.userId));
    case "plan_view":
      return viewPlan();
    case "billing_start_upgrade":
      return startUpgrade(String(args.workspaceId), args.planId === "TEAM" ? "TEAM" : "FAMILY_PLUS");
    case "mail_draft":
    case "mail_send":
    case "calendar_reschedule":
    case "calendar_decline":
    case "calendar_create":
      if (!ctx.autoApproveWrite || !input.writesEnabled()) {
        return { ok: false, summary: "Provider writes are off. Nothing was sent or changed." };
      }
      return providerWrite(call);
    case "daily_brief_read":
      return readBrief();
    case "daily_brief_set_time":
      return setBriefTime(String(args.briefTime));
    case "activity_list":
      return listActivity();
    case "activity_undo":
      return {
        ok: false,
        summary: "Use the Undo button on the action. Sophia does not undo from a guessed id.",
      };
    default:
      return { ok: false, summary: "That tool is not available." };
  }
}

async function createChat(args: Record<string, unknown>) {
  const usernames = Array.isArray(args.usernames) ? args.usernames.map(String) : [];
  if (args.kind === "direct") {
    const conversation = await api.createDirect(usernames[0] ?? "");
    return { ok: true, summary: `Opened a chat with @${usernames[0]}.`, output: { conversationId: conversation.id } };
  }
  const conversation = await api.createGroup({
    memberUsernames: usernames,
    ...(typeof args.title === "string" ? { title: args.title } : {}),
  });
  return { ok: true, summary: "Created the group.", output: { conversationId: conversation.id } };
}

async function sendChat(conversationId: string, body: string) {
  if (!isUnlocked()) {
    return { ok: false, summary: "Unlock this device so Sophia can encrypt with your keys." };
  }
  const payload = await encryptOutgoing(conversationId, body);
  const result = await api.sendMessage(conversationId, payload);
  await storeSentMessage({
    id: result.logicalMessageId,
    conversationId,
    plaintext: body,
    createdAt: result.createdAt,
  });
  return {
    ok: true,
    summary: "Encrypted and sent a message from this device.",
    output: { messageId: result.logicalMessageId, deleteSupported: true },
  };
}

async function renameChat(conversationId: string, title: string) {
  const current = await findConversation(conversationId);
  const renamed = await api.renameConversation(conversationId, title);
  return {
    ok: true,
    summary: `Renamed the group to ${renamed.title}.`,
    before: { title: current?.title ?? renamed.previousTitle ?? "" },
  };
}

async function changeMember(conversationId: string, username: string, op: "add" | "remove") {
  if (op === "add") {
    await api.addGroupMember(conversationId, { username, role: "MEMBER" });
    return { ok: true, summary: `Added @${username}.` };
  }
  const member = await memberByUsername(conversationId, username);
  await api.removeGroupMember(conversationId, member.userId);
  return { ok: true, summary: `Removed @${username}.`, before: { role: member.role } };
}

async function changeRole(conversationId: string, username: string, role: "ADMIN" | "MEMBER") {
  const member = await memberByUsername(conversationId, username);
  await api.setGroupMemberRole(conversationId, member.userId, role);
  return {
    ok: true,
    summary: role === "ADMIN" ? `Promoted @${username}.` : `Changed @${username} to member.`,
    before: { role: member.role },
  };
}

async function leaveChat(conversationId: string) {
  const userId = currentUserId();
  if (!userId) return { ok: false, summary: "Sign in on this device first." };
  await api.removeGroupMember(conversationId, userId);
  return { ok: true, summary: "You left the group." };
}

function listFiles(file: File | null) {
  return {
    ok: true,
    summary: file ? `Selected on this device: ${file.name}` : "No file is selected on this device.",
  };
}

async function stageFile(conversationId: string, filename: string, file: File | null) {
  if (!file || file.name !== filename) {
    return { ok: false, summary: "Choose the file on this device first. Sophia does not read a path from the model." };
  }
  if (!isUnlocked()) return { ok: false, summary: "Unlock this device so Sophia can encrypt the file." };
  const encrypted = await inspectAndEncryptFileAttachment(file);
  const ciphertext = encrypted.ciphertext;
  if (
    ciphertext.byteOffset !== 0 ||
    !(ciphertext.buffer instanceof ArrayBuffer) ||
    ciphertext.byteLength !== ciphertext.buffer.byteLength
  ) {
    return { ok: false, summary: "The encrypted file could not be prepared." };
  }
  const upload = await api.mediaUpload(conversationId, ciphertext.byteLength, "file");
  const uploaded = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: ciphertext.buffer,
  });
  if (!uploaded.ok) return { ok: false, summary: "The encrypted file could not be uploaded." };
  const body = encodeFilePayload({
    id: upload.mediaId,
    k: encrypted.key,
    n: encrypted.nonce,
    name: encrypted.name,
    mime: encrypted.mime,
    bytes: ciphertext.byteLength,
    containsExternalLinks: encrypted.containsExternalLinks,
  });
  const payload = await encryptOutgoing(conversationId, body);
  const sent = await api.sendMessage(conversationId, payload);
  await storeSentMessage({
    id: sent.logicalMessageId,
    conversationId,
    plaintext: body,
    createdAt: sent.createdAt,
  });
  return {
    ok: true,
    summary: `Encrypted and sent ${encrypted.name}.`,
    output: { messageId: sent.logicalMessageId, deleteSupported: true },
  };
}

function requireUser() {
  const userId = currentUserId();
  if (!userId) throw new Error("Sign in on this device first.");
  return userId;
}

function setTheme(theme: string) {
  const userId = requireUser();
  const preset = themes[theme] ?? defaultTokens;
  const record = loadAppearance(userId);
  const current = activeRevision(record);
  const previous = window.localStorage.getItem(themeKey(userId)) || "system";
  const committed = commitAppearance(record, preset, current.voice, "user");
  if (!committed.ok) return { ok: false, summary: "That theme is not available." };
  saveAppearance(userId, committed.record);
  window.localStorage.setItem(themeKey(userId), theme);
  return { ok: true, summary: `Theme set to ${theme}.`, before: { theme: previous } };
}

function setDensity(density: "compact" | "comfortable" | "spacious") {
  const userId = requireUser();
  const record = loadAppearance(userId);
  const current = activeRevision(record);
  const committed = commitAppearance(
    record,
    { ...current.tokens, density },
    current.voice,
    "user",
  );
  if (!committed.ok) return { ok: false, summary: "That density is not available." };
  saveAppearance(userId, committed.record);
  return { ok: true, summary: `Density set to ${density}.`, before: { density: current.tokens.density } };
}

function setVoice(args: Record<string, unknown>) {
  const userId = requireUser();
  const record = loadAppearance(userId);
  const current = activeRevision(record);
  const voice = {
    manner: args.manner === "formal" ? "formal" as const : "friendly" as const,
    verbosity: args.verbosity === "short" ? "short" as const : "detailed" as const,
    language: args.language === "arabic" ? "arabic" as const : args.language === "mixed" ? "mixed" as const : "english" as const,
  };
  const committed = commitAppearance(record, current.tokens, voice, "user");
  if (!committed.ok) return { ok: false, summary: "That draft voice is not available." };
  saveAppearance(userId, committed.record);
  return {
    ok: true,
    summary: "Draft voice saved on this device.",
    before: { ...current.voice },
  };
}

function updateSetting(key: string, value: string, onLocale?: (locale: Locale) => void) {
  if (key === "locale" && (value === "en" || value === "ar")) {
    const previous = window.localStorage.getItem(LOCALE_STORAGE_KEY) || "en";
    onLocale?.(value);
    applyDocumentLocale(value);
    return { ok: true, summary: `Language set to ${value}.`, before: { key: "locale", value: previous } };
  }
  if (key === "reducedMotion" && (value === "on" || value === "off")) {
    const previous = window.localStorage.getItem("sophia-reduced-motion") || "off";
    window.localStorage.setItem("sophia-reduced-motion", value);
    return { ok: true, summary: `Reduced motion is ${value}.`, before: { key: "reducedMotion", value: previous } };
  }
  return { ok: false, summary: "That setting cannot be changed." };
}

function safetyStatus(conversationId: string) {
  const userId = currentUserId();
  if (!userId) return { ok: false, summary: "Sign in on this device first." };
  const record = readSafetyStore(userId).conversations[conversationId];
  const status = record?.state ?? "unseen";
  return {
    ok: true,
    summary: `Stored safety review is ${status}. Sophia cannot mark it verified. Compare the number yourself in Security.`,
    output: { status, agentCanVerify: false },
  };
}

async function createWorkspace(name: string, kind: "FAMILY" | "TEAM") {
  const created = await api.createWorkspace({ name, kind });
  return { ok: true, summary: `Created workspace ${created.workspace.name}.`, output: { workspaceId: created.workspace.id } };
}

async function inviteWorkspace(workspaceId: string) {
  const created = await api.createWorkspaceInvite(workspaceId);
  return {
    ok: true,
    summary: "Created a single-use invite. The code stays on this screen.",
    display: created.invite.path,
    output: { inviteId: created.invite.id },
  };
}

async function revokeInvite(workspaceId: string, inviteId: string) {
  await api.revokeWorkspaceInvite(workspaceId, inviteId);
  return { ok: true, summary: "Revoked the invite." };
}

async function setWorkspaceRole(workspaceId: string, userId: string, role: "ADMIN" | "MEMBER") {
  const members = await api.workspaceMembers(workspaceId);
  const previous = members.members.find((member) => member.userId === userId)?.role ?? "MEMBER";
  await api.setWorkspaceRole(workspaceId, userId, role);
  return { ok: true, summary: `Workspace role set to ${role}.`, before: { role: previous === "OWNER" ? "ADMIN" : previous } };
}

async function removeWorkspaceMember(workspaceId: string, userId: string) {
  await api.removeWorkspaceMember(workspaceId, userId);
  return { ok: true, summary: "Removed the workspace member. Invite them again to return." };
}

async function viewPlan() {
  const { workspaces } = await api.listWorkspaces();
  if (workspaces.length === 0) return { ok: true, summary: "No workspace yet. The personal plan is free." };
  return {
    ok: true,
    summary: workspaces.map((workspace) => `${workspace.name}: ${workspace.planId}`).join("; "),
  };
}

async function startUpgrade(workspaceId: string, planId: "FAMILY_PLUS" | "TEAM") {
  const result = await api.checkoutWorkspace(workspaceId, { planId });
  if (!result.checkoutUrl) {
    return { ok: true, summary: "Billing is off, so no upgrade link was opened and nothing was charged." };
  }
  return {
    ok: true,
    summary: "Upgrade link is ready. The charge still happens at the provider.",
    display: result.checkoutUrl,
  };
}

async function providerWrite(call: ValidatedToolCall) {
  const proposalId = crypto.randomUUID();
  if (call.name === "mail_send" || call.name === "mail_draft") {
    const body = {
      to: call.args.to as string[],
      subject: String(call.args.subject),
      body: String(call.args.body),
    };
    const provider = call.args.provider === "outlook-mail" ? "outlook-mail" as const : "gmail" as const;
    if (call.name === "mail_send") {
      await api.sendEmail(provider, body, proposalId);
      return { ok: true, summary: "Sent the email through the approval path." };
    }
    await api.createEmailDraft(provider, body, proposalId);
    return { ok: true, summary: "Saved the email draft through the approval path." };
  }
  const provider = call.args.provider === "outlook" ? "outlook" as const : "google" as const;
  if (call.name === "calendar_create") {
    const created = await api.createCalendarEvent(provider, {
      title: String(call.args.title),
      startsAt: String(call.args.startsAt),
      endsAt: String(call.args.endsAt),
    });
    return {
      ok: true,
      summary: "Created the calendar event.",
      output: { eventId: created.externalEventId },
    };
  }
  if (call.name === "calendar_decline") {
    await api.deleteCalendarEvent(provider, String(call.args.eventId), proposalId);
    return { ok: true, summary: "Declined the calendar event through the approval path." };
  }
  await api.updateCalendarEvent(provider, String(call.args.eventId), {
    title: typeof call.args.title === "string" ? call.args.title : "Event",
    startsAt: String(call.args.startsAt),
    endsAt: String(call.args.endsAt),
  }, proposalId);
  return { ok: true, summary: "Rescheduled the event through the approval path." };
}

async function readBrief() {
  const response = await api.dailyBrief();
  const brief = response.brief;
  if (!brief) {
    return {
      ok: true,
      summary: response.pendingReason === "not_connected"
        ? "Connect mail or a calendar to prepare the brief."
        : "The brief is not ready yet.",
    };
  }
  const titles = brief.meetings.slice(0, 3).map((meeting) => meeting.title).join(", ");
  return {
    ok: true,
    summary: `Meetings ${brief.meetings.length}, replies ${brief.needsReply.length}, overdue ${brief.overdueFollowUps.length}.${titles ? ` Next: ${titles}.` : ""}`,
  };
}

async function setBriefTime(briefTime: string) {
  const current = await api.dailyBrief();
  await api.saveDailyBriefPreference({
    briefTime,
    language: current.preference.language,
    timeZone: current.preference.timeZone,
  });
  return {
    ok: true,
    summary: `Daily brief time set to ${briefTime}.`,
    before: { briefTime: current.preference.briefTime },
  };
}

async function listActivity() {
  const page = await api.listActivity();
  const lines = page.events.slice(0, 5).map((event) => event.summary);
  return { ok: true, summary: lines.length ? lines.join(" | ") : "No activity yet." };
}

async function findConversation(conversationId: string) {
  const { conversations } = await api.conversations();
  return conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

async function memberByUsername(conversationId: string, username: string) {
  const conversation = await findConversation(conversationId);
  const member = conversation?.members?.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!member) throw new Error("That member is not in the conversation.");
  return member;
}
