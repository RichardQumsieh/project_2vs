"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Calendar, CheckSquare, Mail, MapPin, Paperclip, Phone, Send, Settings, Smile, UserRound, Video, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChatPresence } from "@/components/avatar/chat-presence";
import { PersonAvatar } from "@/components/avatar/person-avatar";
import { ExperimentalBadge } from "@/components/experimental-badge";
import { outgoingTextDestination } from "@/lib/ai/chat-route";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GroupThread, GroupUnavailable, NewGroupForm } from "@/components/group-thread";
import { groupE2eeEnabled } from "@/lib/group-e2ee-flag";
import { api } from "@/lib/api";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { localizedRuntimeMessage } from "@/lib/i18n/action-summary";
import { useI18n } from "@/lib/i18n/locale";
import {
  acknowledgeArchiveRecoveryCode,
  bootstrapDevice,
  conversationPlaintext,
  currentDeviceId,
  currentUserId,
  applyRemoteMessageDeletion,
  encryptOutgoing,
  forgetRememberedDevice,
  getPendingArchiveRecoveryCode,
  getRecoveryBackupError,
  ingestWireMessages,
  isUnlocked,
  lockDevice,
  restoreRememberedDevice,
  syncConversationRecoveryHistory,
  syncConversationMessageDeletions,
  syncCurrentDeviceRecovery,
  storeSentMessage,
} from "@/lib/session";
import { messageSchema, usernameSchema, unlockSchema } from "@/lib/validators";
import { PhotoEditor } from "@/components/photo-editor";
import {
  VoiceNoteRecorder,
  type RecordedVoiceNote,
} from "@/components/voice-note-recorder";
import { UserDiscovery } from "@/components/user-discovery";
import { SophiaMark } from "@/components/sophia-mark";
import { useRealtime } from "@/lib/use-realtime";
import {
  localInferenceProvider,
  resetLocalInferenceProvider,
} from "@/lib/ai/local-provider";
import { summarizeConversation } from "@/lib/ai/summarize";
import {
  generateResearchAnswer,
  generateCompanionReply,
  type CompanionTurn,
} from "@/lib/ai/companion";
import {
  getAutomaticResearchQuery,
  searchWeb,
} from "@/lib/ai/research";
import type {
  InferenceProgress,
  SummaryLanguage,
  SummaryTone,
} from "@/lib/ai/types";
import {
  defaultAssistantSettings,
  loadAssistantSettings,
  saveAssistantSettings,
  type AssistantSettings,
} from "@/lib/ai/assistant-settings";
import {
  canSpeakAutomatically,
  createBrowserSpeechProvider,
  createIncomingSpeechTracker,
  createSpeechQueue,
  isAllowedAutomaticSpeechText,
  isSafeSpeechText,
  speechLanguage,
  type SpeechQueue,
  type SpeechVoice,
} from "@/lib/ai/voice-companion";
import { createOnDeviceSpeechInputProvider } from "@/lib/ai/speech-input";
import {
  agentActionSummary,
  buildApprovedSearchUrl,
  createAgentRuntime,
  type AgentProposal,
  type AgentProposalProvenance,
  type AgentRuntime,
  type AgentToolAction,
} from "@/lib/ai/agent-runtime";
import { downloadSophiaDocument } from "@/lib/ai/sophia-documents";
import { SophiaRobot } from "@/components/sophia-robot";
import {
  InboxActivityPanel,
  InboxActivityState,
  InboxComposeLetter,
} from "@/components/inbox-activity-panel";
import { SophiaCommandHints } from "@/components/sophia-command-hints";
import { ThreadMessageList } from "@/components/thread-message-list";
import { emailApiPayload, type InboxActivityView } from "@/lib/inbox-activity";
import { inboxHubHref, type InboxHub } from "@/lib/inbox-hub";
import { InboxHubNav } from "@/components/inbox-hub-nav";
import {
  SophiaApproveSuccess,
  SophiaProposalCard,
} from "@/components/sophia-proposal-card";
import { draftVoiceForUser } from "@/lib/appearance/store";
import {
  parseSophiaCommand,
  type SophiaIntent,
} from "@/lib/ai/sophia-planner";
import {
  buildBriefingStagedAction,
  buildDeadlineProposals,
  buildRadarSecondaryActions,
  isJobManagerTool,
  type JobManagerDefaults,
} from "@/lib/ai/sophia-job-tools";
import {
  loadJobDefaults,
  saveJobDefaults,
} from "@/lib/ai/sophia-job-defaults";
import {
  addMemoryFact,
  loadPersonalMemory,
  removeMemoryFact,
  savePersonalMemory,
  type MemoryFact,
} from "@/lib/ai/personal-memory";
import {
  createCompanionRuntime,
  type CompanionObservation,
  type CompanionPresenceState,
  type CompanionRuntime,
} from "@/lib/ai/companion-runtime";
import {
  acceptFindingAsTaskDraft,
  createFollowUpTaskDraft,
  dismissFinding,
  emptyRadarStoreState,
  isConversationAllowed,
  listPendingFindings,
  loadRadarStore,
  saveRadarStore,
  setConversationAllowed,
  snoozeFinding,
  updateTaskDraft,
  upsertFindings,
  type RadarFinding,
  type RadarStoreState,
  type RadarTaskDraft,
} from "@/lib/ai/radar-store";
import { createRadarRuntime, type RadarRuntime } from "@/lib/ai/radar-runtime";
import { syncAcceptedTaskDraft } from "@/lib/ai/radar-sync";
import {
  buildDailyBriefing,
  bumpRadarCounter,
  emptyRadarClientCounters,
  loadRadarClientCounters,
  saveRadarClientCounters,
  type RadarBriefing,
  type RadarClientCounters,
} from "@/lib/ai/radar-briefing";
import {
  generateSuggestedReplies,
  type SuggestionRequest,
} from "@/lib/ai/suggestions";
import {
  createSuggestionScheduler,
  createSuggestionRetryGate,
  latestIncomingMessageId,
} from "@/lib/ai/suggestion-scheduler";
import type { LocalMessage } from "@/lib/crypto/types";
import { isMessageFromUser } from "@/lib/crypto/message-ownership";
import { dedupeLogicalMessages } from "@/lib/crypto/logical-messages";
import { encryptPhotoFile, maxPhotoBytes } from "@/lib/crypto/media";
import {
  encryptVideoFile,
  maxVideoDurationSeconds,
  maxVideoSourceBytes,
  readVideoDuration,
} from "@/lib/crypto/video";
import { encryptVoiceNoteBytes } from "@/lib/crypto/voice-note";
import {
  inspectAndEncryptFileAttachment,
  maxFileAttachmentBytes,
  sanitizeAttachmentName,
  type EncryptedFileAttachment as PreparedFileAttachment,
} from "@/lib/crypto/file-attachment";
import {
  encodeAlbumPayload,
  encodeImagePayload,
  encodeReplyPayload,
  encodeVideoPayload,
  encodeVoicePayload,
  encodeFilePayload,
  encodeLocationPayload,
  localMessageForAssistant,
  maxAlbumPhotos,
  messagePreviewText,
  parseChatPayload,
} from "@/lib/chat-payload";
import {
  describeLocationAccuracy,
  formatCoordinate,
  readBrowserLocation,
  type PendingLocationShare,
} from "@/lib/location-share";
import { assertOutgoingLinksSafe } from "@/lib/url-safety";
import { CallProvider, useCallControls } from "@/components/call-provider";

const emptyLocalMessages: LocalMessage[] = [];

export function InboxShell({
  children,
  hub = "chats",
  mailView = "agenda",
}: {
  children?: React.ReactNode;
  hub?: InboxHub;
  mailView?: InboxActivityView;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const activeConversationId = useParams<{ id?: string }>().id;
  const [homeView, setHomeView] = useState<InboxActivityView>(mailView);
  const [mailViewSeen, setMailViewSeen] = useState(mailView);
  if (mailView !== mailViewSeen) {
    setMailViewSeen(mailView);
    setHomeView(mailView);
  }
  const [composeRequest, setComposeRequest] = useState(0);
  const setHomeActivityView = useCallback((view: InboxActivityView) => {
    setHomeView(view);
    if (view === "email") {
      setComposeRequest((current) => current + 1);
    }
    const href = inboxHubHref("mail", view);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      router.replace(href);
    }
  }, [router]);
  const closeHomeActivity = useCallback(() => {
    router.push(inboxHubHref("chats"));
  }, [router]);
  const queryClient = useQueryClient();
  const [unlockedUserId, setUnlockedUserId] = useState<string | null>(() =>
    isUnlocked() ? currentUserId() : null,
  );
  const unlocked = Boolean(
    unlockedUserId &&
    isUnlocked() &&
    currentUserId() === unlockedUserId,
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [historyRecoveryNotice, setHistoryRecoveryNotice] = useState(false);
  const [historyWasUnavailable, setHistoryWasUnavailable] = useState(false);
  const [pendingHistoryRecoveryCode, setPendingHistoryRecoveryCode] = useState<string | null>(
    () => getPendingArchiveRecoveryCode(),
  );
  const [historyRecoveryCodeSaved, setHistoryRecoveryCodeSaved] = useState(false);
  const [historyRecoveryCodeCopyError, setHistoryRecoveryCodeCopyError] = useState(false);
  const [historyRecoveryCodeAckError, setHistoryRecoveryCodeAckError] = useState(false);
  const [recoverySyncError, setRecoverySyncError] = useState<string | null>(null);
  const [recoverySyncProgress, setRecoverySyncProgress] = useState<{
    conversation: number;
    total: number;
    messages: number;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [restoringRememberedDevice, setRestoringRememberedDevice] =
    useState(true);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });
  const identityMatchesAccount =
    Boolean(me.data && currentUserId() === me.data.user.id);

  useEffect(() => {
    const updatePendingCode = () =>
      setPendingHistoryRecoveryCode(getPendingArchiveRecoveryCode());
    window.addEventListener("private-messenger-archive-recovery-code", updatePendingCode);
    return () =>
      window.removeEventListener("private-messenger-archive-recovery-code", updatePendingCode);
  }, []);

  useEffect(() => {
    if (!unlocked || !identityMatchesAccount || !me.data) return;
    if (
      window.sessionStorage.getItem(
        "private-messenger-history-recovery-unavailable",
      ) === "true"
    ) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRecoverySyncError(getRecoveryBackupError());
      setRecoverySyncProgress({ conversation: 0, total: 0, messages: 0 });
      void syncConversationRecoveryHistory((progress) => {
        if (!cancelled) setRecoverySyncProgress(progress);
      })
        .then(() => {
          if (!cancelled) {
            setRecoverySyncProgress(null);
            setRecoverySyncError(getRecoveryBackupError());
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setRecoverySyncProgress(null);
            setRecoverySyncError(
              error instanceof Error
                ? error.message
                : "Could not back up this device's encrypted message history.",
            );
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [identityMatchesAccount, me.data, unlocked]);

  useEffect(() => {
    const updateStatus = () => setRecoverySyncError(getRecoveryBackupError());
    window.addEventListener("private-messenger-recovery-backup", updateStatus);
    const timer = window.setTimeout(updateStatus, 0);
    return () => {
      window.removeEventListener("private-messenger-recovery-backup", updateStatus);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (
      window.sessionStorage.getItem(
        "private-messenger-history-recovery-unavailable",
      ) === "true"
    ) {
      window.sessionStorage.removeItem(
        "private-messenger-history-recovery-unavailable",
      );
      const noticeTimer = window.setTimeout(
        () => {
          setHistoryWasUnavailable(true);
          setHistoryRecoveryNotice(true);
        },
        0,
      );
      return () => window.clearTimeout(noticeTimer);
    }
  }, []);
  useRealtime(
    unlocked && identityMatchesAccount,
    me.data?.user.id ?? null,
  );

  const conversations = useQuery({
    queryKey: ["conversations", me.data?.user.id],
    queryFn: async () => (await api.conversations()).conversations,
    enabled: Boolean(me.data) && unlocked && identityMatchesAccount,
  });

  useEffect(() => {
    if (me.isError) {
      void lockDevice().finally(() => {
        setUnlockedUserId(null);
        queryClient.clear();
        router.replace("/login");
      });
    }
  }, [me.isError, queryClient, router]);

  useEffect(() => {
    if (
      me.isLoading ||
      !me.data ||
      (unlocked && identityMatchesAccount)
    ) {
      return;
    }

    let cancelled = false;
    void restoreRememberedDevice(me.data)
      .then((restored) => {
        if (restored && !cancelled) {
          setLogoutError(null);
          setUnlockedUserId(me.data.user.id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLogoutError(
            error instanceof Error
              ? error.message
              : "Could not restore the remembered local vault. Unlock with your password.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRestoringRememberedDevice(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [identityMatchesAccount, me.data, me.isLoading, unlocked]);

  const start = useForm({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: "" },
  });

  async function logOut() {
    setLogoutError(null);
    setLoggingOut(true);
    let localForgetError: string | null = null;
    if (me.data?.user.id) {
      try {
        await forgetRememberedDevice(me.data.user.id);
      } catch {
        localForgetError =
          "Could not remove the saved local unlock key. Clear this browser's site data if you are giving the device away.";
      }
    }
    await lockDevice();
    setUnlockedUserId(null);
    queryClient.clear();
    try {
      await api.logout();
      window.location.replace("/login");
    } catch (error) {
      setLogoutError(
        error instanceof Error
          ? `${localForgetError ? `${localForgetError} ` : ""}Could not complete server sign-out: ${error.message}`
          : `${localForgetError ? `${localForgetError} ` : ""}Could not complete server sign-out. Check your connection and retry.`,
      );
    } finally {
      setLoggingOut(false);
    }
  }

  function retryRecoverySync() {
    setRecoverySyncError(null);
    setRecoverySyncProgress({ conversation: 0, total: 0, messages: 0 });
    const sync = historyWasUnavailable
      ? syncCurrentDeviceRecovery()
      : syncConversationRecoveryHistory((progress) => {
          setRecoverySyncProgress(progress);
        });
    void sync
      .then(() => {
        setRecoverySyncProgress(null);
        setRecoverySyncError(getRecoveryBackupError());
      })
      .catch((error: unknown) => {
        setRecoverySyncProgress(null);
        setRecoverySyncError(
          error instanceof Error
            ? error.message
            : "Could not back up this device's encrypted message history.",
        );
      });
  }

  if (me.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-white/50">
        {t("inbox.loading")}
      </main>
    );
  }

  if (me.data && (!unlocked || !identityMatchesAccount)) {
    if (restoringRememberedDevice) {
      return (
        <main className="flex min-h-screen items-center justify-center text-white/50">
          {t("inbox.restoring")}
        </main>
      );
    }
    return (
      <UnlockPanel
        error={logoutError}
        loggingOut={loggingOut}
        onLogout={logOut}
        onUnlock={() => {
          setLogoutError(null);
          setUnlockedUserId(me.data.user.id);
        }}
      />
    );
  }

  if (!me.data || !unlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center text-white/50">
        {t("inbox.unlocking")}
      </main>
    );
  }

  return (
    <CallProvider
      enabled={unlocked && identityMatchesAccount}
      userId={me.data.user.id}
    >
    <InboxActivityState
      view={homeView}
      setView={setHomeActivityView}
      mobileOpen={hub === "mail"}
      closeMobile={closeHomeActivity}
      composeRequest={composeRequest}
    >
    <main
      className="inbox-shell inbox-shell--pro"
      data-hub={hub}
      data-pane={activeConversationId || hub !== "chats" ? "detail" : "list"}
    >
      {pendingHistoryRecoveryCode ? (
        <div
          role="alertdialog"
          aria-labelledby="history-recovery-code-title"
          aria-describedby="history-recovery-code-description"
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4"
        >
          <section className="w-full max-w-lg space-y-4 rounded-3xl border border-white/10 bg-[#15171d] p-6 shadow-2xl">
            <h2 id="history-recovery-code-title" className="text-lg font-semibold">
              {t("inbox.saveCodeTitle")}
            </h2>
            <p id="history-recovery-code-description" className="text-sm text-white/55">
              {t("inbox.saveCodeBody")}
            </p>
            <code className="block break-all rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 font-mono text-sm text-white">
              {pendingHistoryRecoveryCode}
            </code>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              title={t("inbox.copyCode")}
              aria-label={t("inbox.copyCode")}
              onClick={() => {
                setHistoryRecoveryCodeCopyError(false);
                if (!navigator.clipboard) {
                  setHistoryRecoveryCodeCopyError(true);
                  return;
                }
                void navigator.clipboard.writeText(pendingHistoryRecoveryCode).catch(() =>
                  setHistoryRecoveryCodeCopyError(true),
                );
              }}
            >
              {t("inbox.copyCode")}
            </Button>
            {historyRecoveryCodeCopyError ? (
              <p className="text-sm text-red-300">{t("inbox.copyFailed")}</p>
            ) : null}
            {historyRecoveryCodeAckError ? (
              <p className="text-sm text-red-300">{t("inbox.ackFailed")}</p>
            ) : null}
            <label className="flex items-start gap-3 text-sm text-white/65">
              <input
                type="checkbox"
                checked={historyRecoveryCodeSaved}
                onChange={(event) => setHistoryRecoveryCodeSaved(event.target.checked)}
                className="mt-1 accent-(--accent)"
              />
              {t("inbox.savedCode")}
            </label>
            <Button
              type="button"
              className="w-full"
              title={t("auth.continue")}
              aria-label={t("auth.continue")}
              disabled={!historyRecoveryCodeSaved}
              onClick={() => {
                setHistoryRecoveryCodeAckError(false);
                void acknowledgeArchiveRecoveryCode().then(() => {
                  setPendingHistoryRecoveryCode(null);
                }).catch(() => setHistoryRecoveryCodeAckError(true));
              }}
            >
              {t("auth.continue")}
            </Button>
          </section>
        </div>
      ) : null}
      {historyRecoveryNotice ? (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-[120] mx-auto flex max-w-2xl items-start justify-between gap-4 rounded-2xl border border-amber-200/20 bg-[#241d11]/95 px-4 py-3 text-sm text-amber-100 shadow-xl"
        >
          <p>
            This account had an older device without portable history. Messages already lost before this device could decrypt and archive them cannot be recovered. Available messages are now being copied to the encrypted account archive.
          </p>
          <button
            type="button"
            className="shrink-0 text-amber-100/70 hover:text-white"
            title={t("inbox.dismissRecovery")}
            aria-label={t("inbox.dismissRecovery")}
            onClick={() => setHistoryRecoveryNotice(false)}
          >
            ×
          </button>
        </div>
      ) : null}
      {recoverySyncError ? (
        <div
          role="alert"
          className="fixed inset-x-4 top-4 z-[120] mx-auto flex max-w-2xl items-start justify-between gap-4 rounded-2xl border border-red-200/20 bg-[#241114]/95 px-4 py-3 text-sm text-red-100 shadow-xl"
        >
          <p>
            Cross-device encrypted history sync is incomplete. Keep this browser data and retry when connected. {recoverySyncError}
          </p>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            title={t("inbox.retry")}
            aria-label={t("inbox.retry")}
            onClick={retryRecoverySync}
          >
            {t("inbox.retry")}
          </button>
        </div>
      ) : recoverySyncProgress ? (
        <div
          role="status"
          className="fixed inset-x-4 top-4 z-[120] mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[#111318]/95 px-4 py-3 text-sm text-white/75 shadow-xl"
        >
          Securing encrypted message history for recovery
          {recoverySyncProgress.total
            ? ` · conversation ${recoverySyncProgress.conversation} of ${recoverySyncProgress.total} · ${recoverySyncProgress.messages} messages checked`
            : "…"}
        </div>
      ) : null}
      <aside className="inbox-sidebar flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-white/10">
        <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="shrink-0 space-y-3 border-b border-white/10 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <SophiaMark />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight text-white">
                {t("inbox.title")}
                <ExperimentalBadge />
              </h1>
              <p className="truncate text-xs text-white/50"><LtrIsolate>@{me.data.user.username}</LtrIsolate></p>
            </div>
          </div>
          <Link
            href="/settings"
            title={t("inbox.settings")}
            aria-label={t("inbox.settings")}
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/10 text-white/75 hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
          >
            <Settings aria-hidden="true" className="size-4" />
          </Link>
        </div>

        <InboxHubNav hub={activeConversationId ? "chats" : hub} className="inbox-hub-nav inbox-hub-nav--sidebar" />

        <div className="grid grid-cols-2 gap-2">
          <Button
            asChild
            size="sm"
            variant={hub === "mail" && homeView === "email" ? "default" : "outline"}
            className="gap-1.5"
          >
            <Link
              href={inboxHubHref("mail", "email")}
              title={t("inbox.compose")}
              aria-label={t("inbox.compose")}
              onClick={() => {
                setHomeView("email");
                setComposeRequest((current) => current + 1);
              }}
            >
              <Mail aria-hidden="true" className="size-3.5" />
              {t("inbox.compose")}
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={hub === "mail" && homeView === "event" ? "default" : "outline"}
            className="gap-1.5"
          >
            <Link href={inboxHubHref("mail", "event")} title={t("inbox.schedule")} aria-label={t("inbox.schedule")} onClick={() => setHomeView("event")}>
              <Calendar aria-hidden="true" className="size-3.5" />
              {t("inbox.schedule")}
            </Link>
          </Button>
        </div>
        <Link
          href={inboxHubHref("mail")}
          title={t("inbox.recent")}
          aria-label={t("inbox.recent")}
          className="text-start text-xs text-white/55 underline underline-offset-2 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
          onClick={() => setHomeView("agenda")}
        >
          {t("inbox.recent")}
        </Link>

        <form
          className="flex gap-2"
          onSubmit={start.handleSubmit(async ({ username }) => {
            setStartError(null);
            try {
              const conversation = await api.createDirect(username.trim());
              await queryClient.invalidateQueries({ queryKey: ["conversations"] });
              router.push(`/inbox/${conversation.id}`);
              start.reset();
            } catch (error) {
              setStartError(error instanceof Error ? error.message : "Could not start conversation.");
            }
          })}
        >
          <Input dir="ltr" placeholder={t("inbox.username")} title={t("inbox.username")} aria-label={t("inbox.username")} {...start.register("username")} />
          <Button type="submit" size="sm" className="gap-1.5" title={t("inbox.chat")} aria-label={t("inbox.chat")}>
            <UserRound aria-hidden="true" className="size-3.5" />
            {t("inbox.chat")}
          </Button>
        </form>
        {startError ? <p className="text-sm text-red-300">{startError}</p> : null}
        {groupE2eeEnabled() ? <NewGroupForm /> : null}
        </div>

        <nav aria-label={t("inbox.conversations")} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
          {(conversations.data ?? []).map((conversation) => {
            const memberCount = conversation.members?.length ?? conversation.memberUserIds?.length ?? 0;
            const label = conversation.type === "GROUP"
              ? conversation.title?.trim() || t("group.fallbackTitle")
              : conversation.peer?.displayName ?? conversation.peer?.username ?? t("inbox.unknown");
            const selected = conversation.id === activeConversationId;
            return (
            <Link
              key={conversation.id}
              href={`/inbox/${conversation.id}`}
              title={label}
              aria-label={label}
              aria-current={selected ? "page" : undefined}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) ${
                selected
                  ? "border-cyan-300/40 bg-white/[0.07]"
                  : "border-white/10 bg-white/[0.02] hover:border-cyan-300/25 hover:bg-white/[0.05]"
              }`}
            >
              <PersonAvatar
                person={conversation.type === "GROUP" ? null : conversation.peer}
                title={label.slice(0, 1).toUpperCase()}
                size={36}
              />
              <span className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium tracking-tight"><BidiText>{label}</BidiText></p>
                <p className="mt-0.5 truncate text-xs text-white/40">
                  {conversation.type === "GROUP" ? (
                    <BidiText>{t("group.memberCount", { count: memberCount })}</BidiText>
                  ) : conversation.peer?.username ? (
                    <LtrIsolate>@{conversation.peer.username}</LtrIsolate>
                  ) : null}
                </p>
              </span>
              {conversation.type === "GROUP" && (conversation.unreadCount ?? 0) > 0 ? (
                <span
                  className="ms-auto shrink-0 rounded-full bg-cyan-300/20 px-2 py-0.5 text-[11px] font-medium text-cyan-50"
                  aria-label={t("group.unread", { count: conversation.unreadCount ?? 0 })}
                >
                  {conversation.unreadCount}
                </span>
              ) : null}
            </Link>
            );
          })}
          <UserDiscovery
            key={me.data.user.id}
            userId={me.data.user.id}
            interests={me.data.user.interests}
          />
        </nav>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
          <Link
            href="/inbox?hub=assistant"
            title={t("inbox.hub.assistant")}
            aria-label={t("inbox.hub.assistant")}
            className="rounded-full px-2 py-1 text-xs text-cyan-100/80 hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
          >
            <span className="inline-flex items-center gap-2">
              Sophia
              <ExperimentalBadge />
            </span>
          </Link>
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="sm"
            title={loggingOut ? t("inbox.loggingOut") : t("inbox.logout")}
            aria-label={loggingOut ? t("inbox.loggingOut") : t("inbox.logout")}
            disabled={loggingOut}
            onClick={() => void logOut()}
          >
            {loggingOut ? t("inbox.loggingOut") : t("inbox.logout")}
          </Button>
        </div>
        </div>
      </aside>
      <section className="inbox-stage">
        {children}
      </section>
      <InboxHubNav
        hub={activeConversationId ? "chats" : hub}
        className="inbox-hub-nav inbox-hub-nav--bottom"
      />
    </main>
    </InboxActivityState>
    </CallProvider>
  );
}

export function Thread() {
  const conversationId = useParams<{ id: string }>().id;
  const { t } = useI18n();
  const userId = currentUserId();
  const conversations = useQuery({
    queryKey: ["conversations", userId],
    queryFn: async () => (await api.conversations()).conversations,
    enabled: Boolean(userId),
  });
  if (userId && !conversations.data) {
    return <p className="p-6 text-sm text-white/60">{t("group.loading")}</p>;
  }
  const conversation = conversations.data?.find((item) => item.id === conversationId);
  if (conversation?.type === "GROUP") {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        {groupE2eeEnabled() ? <GroupThread conversation={conversation} /> : <GroupUnavailable />}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ThreadConversation conversationId={conversationId} />
    </div>
  );
}

function ThreadConversation({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const calls = useCallControls();
  const [olderMessages, setOlderMessages] = useState<LocalMessage[]>([]);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteMessageError, setDeleteMessageError] = useState<string | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const selectedPhoto = selectedPhotos[0] ?? null;
  const [replySelectMode, setReplySelectMode] = useState(false);
  const [selectedReplyIds, setSelectedReplyIds] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [selectedVoiceNote, setSelectedVoiceNote] =
    useState<RecordedVoiceNote | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    file: File;
    encrypted: PreparedFileAttachment;
  } | null>(null);
  const [selectedLocation, setSelectedLocation] =
    useState<PendingLocationShare | null>(null);
  const [locating, setLocating] = useState(false);
  const [sentNotice, setSentNotice] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [recordingVoiceNote, setRecordingVoiceNote] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [assistantSettings, setAssistantSettings] =
    useState<AssistantSettings | null>(null);
  const [assistantSettingsError, setAssistantSettingsError] =
    useState<string | null>(null);
  const [speechVoices, setSpeechVoices] = useState<SpeechVoice[]>([]);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionObservation, setCompanionObservation] =
    useState<CompanionObservation | null>(null);
  const [agentProposals, setAgentProposals] = useState<AgentProposal[]>([]);
  const [agentActionError, setAgentActionError] = useState<string | null>(null);
  const [approveFlash, setApproveFlash] = useState<string | null>(null);
  const [activitySheet, setActivitySheet] = useState<InboxActivityView | null>(null);
  const approveFlashTimer = useRef<number | null>(null);
  const [jobDefaults, setJobDefaults] = useState<JobManagerDefaults>({});
  const jobDefaultsRef = useRef<JobManagerDefaults>({});
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [researchQuery, setResearchQuery] = useState("");
  const [approvedSearchUrl, setApprovedSearchUrl] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [companionPresence, setCompanionPresence] =
    useState<CompanionPresenceState>("idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [allowBrowserSpeech, setAllowBrowserSpeech] = useState(false);
  const [companionTurns, setCompanionTurns] = useState<CompanionTurn[]>([]);
  const [companionInput, setCompanionInput] = useState("");
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionProgress, setCompanionProgress] =
    useState<InferenceProgress | null>(null);
  const [companionError, setCompanionError] = useState<string | null>(null);
  const [companionUsesChatContext, setCompanionUsesChatContext] =
    useState(true);
  const [personalMemory, setPersonalMemory] = useState<MemoryFact[]>([]);
  const [radarStore, setRadarStore] = useState<RadarStoreState>(() =>
    emptyRadarStoreState(),
  );
  const [radarFindingEdits, setRadarFindingEdits] = useState<
    Record<string, { title: string; dueAt: string }>
  >({});
  const [radarStoreError, setRadarStoreError] = useState<string | null>(null);
  const [radarBriefing, setRadarBriefing] = useState<RadarBriefing | null>(null);
  const [radarCounters, setRadarCounters] = useState<RadarClientCounters>(() =>
    emptyRadarClientCounters(),
  );
  const [speakCompanionReplies, setSpeakCompanionReplies] = useState(false);
  const [listeningForCompanion, setListeningForCompanion] = useState(false);
  const [localSpeechInputAvailability, setLocalSpeechInputAvailability] =
    useState({ english: false, arabic: false });
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const [suggestionView, setSuggestionView] = useState<{
    key: string;
    messageId: string;
    status: "loading" | "ready" | "error";
    suggestions: string[];
    error?: string;
    progress?: InferenceProgress;
  } | null>(null);
  const [suggestionRetry, setSuggestionRetry] = useState(0);
  const [dismissedSuggestionsFor, setDismissedSuggestionsFor] =
    useState<string | null>(null);
  const [summaryLanguage, setSummaryLanguage] =
    useState<SummaryLanguage>("auto");
  const [summaryTone, setSummaryTone] =
    useState<SummaryTone>("concise");
  const [summary, setSummary] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  const [summaryError, setSummaryError] = useState<{
    conversationId: string;
    message: string;
  } | null>(null);
  const [summaryProgress, setSummaryProgress] =
    useState<InferenceProgress | null>(null);
  const [summaryRun, setSummaryRun] = useState<{
    conversationId: string;
    controller: AbortController;
  } | null>(null);
  const summaryController = useRef<AbortController | null>(null);
  const companionController = useRef<AbortController | null>(null);
  const companionContextMessageId = useRef<string | null>(null);
  const speechInputController = useRef<AbortController | null>(null);
  const speechInputProvider = useRef(createOnDeviceSpeechInputProvider());
  const handledSuggestionKey = useRef<string | null>(null);
  const autoRetriedSuggestionKeys = useRef(createSuggestionRetryGate());
  const attemptedAutomaticSpeech = useRef(new Set<string>());
  const selectedSpeechSequence = useRef(0);
  const incomingSpeechTracker = useRef(createIncomingSpeechTracker());
  const speechQueueRef = useRef<SpeechQueue | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  const schedulerRef = useRef(
    createSuggestionScheduler(),
  );
  const agentRuntimeRef = useRef<AgentRuntime | null>(null);
  const radarUserIdRef = useRef<string | null>(null);
  const radarStoreRef = useRef<RadarStoreState>(emptyRadarStoreState());
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoSelectionRequest = useRef(0);
  const fileSelectionRequest = useRef(0);
  const selectedPhotoPreviewRefs = useRef<(HTMLImageElement | null)[]>([]);
  const selectedVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const selectedAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const latestScrolledMessageId = useRef<string | null>(null);
  const pendingHistoryScroll = useRef<{ height: number; top: number } | null>(null);
  const [companionRuntime] = useState<CompanionRuntime>(() =>
    createCompanionRuntime({
      onObservation: (observation) => setCompanionObservation(observation),
      onStateChange: (state) => setCompanionPresence(state),
      onMessageEvent: () => setCompanionObservation(null),
    }),
  );
  const [radarRuntime] = useState<RadarRuntime>(() =>
    createRadarRuntime({
      onFindings: (findings) => {
        const userId = radarUserIdRef.current;
        if (!userId || !findings.length) {
          return;
        }
        setRadarStore((previous) => {
          const existingIds = new Set(previous.findings.map((item) => item.id));
          const newlyProposed = findings.filter(
            (finding) => !existingIds.has(finding.id),
          ).length;
          const next = upsertFindings(previous, findings);
          radarStoreRef.current = next;
          void saveRadarStore(userId, next).then((ok) => {
            setRadarStoreError(
              ok ? null : "Could not save Radar findings in this browser.",
            );
          });
          if (newlyProposed > 0) {
            setRadarCounters((counters) => {
              const bumped = bumpRadarCounter(
                counters,
                "findingsProposed",
                newlyProposed,
              );
              saveRadarClientCounters(userId, bumped);
              return bumped;
            });
          }
          return next;
        });
      },
    }),
  );
  const summarizing =
    summaryRun?.conversationId === conversationId &&
    !summaryRun.controller.signal.aborted;
  const aiIsThinking =
    companionBusy ||
    researching ||
    summarizing ||
    suggestionView?.status === "loading";
  const aiWorkLabel = researching
    ? "Searching the web"
    : companionBusy || summarizing
      ? "Thinking on this device"
      : suggestionView?.status === "loading"
        ? "Preparing reply suggestions"
        : companionPresence.replace("-", " ");

  const activeUserId = currentUserId();
  const conversations = useQuery({
    queryKey: ["conversations", activeUserId],
    queryFn: async () => (await api.conversations()).conversations,
  });
  const conversation = conversations.data?.find((item) => item.id === conversationId);
  const conversationRadarAllowed = isConversationAllowed(
    radarStore,
    conversationId,
  );
  const pendingRadarFindings = listPendingFindings(radarStore, conversationId);

  useEffect(() => {
    setPersonalMemory(activeUserId ? loadPersonalMemory(activeUserId) : []);
  }, [activeUserId]);

  useEffect(() => {
    const defaults = loadJobDefaults(activeUserId);
    jobDefaultsRef.current = defaults;
    setJobDefaults(defaults);
  }, [activeUserId]);

  useEffect(() => {
    jobDefaultsRef.current = jobDefaults;
  }, [jobDefaults]);

  useEffect(() => {
    return () => {
      if (approveFlashTimer.current !== null) {
        window.clearTimeout(approveFlashTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    radarUserIdRef.current = activeUserId;
    setRadarFindingEdits({});
    setRadarStoreError(null);
    setRadarBriefing(null);
    if (!activeUserId) {
      const empty = emptyRadarStoreState();
      radarStoreRef.current = empty;
      setRadarStore(empty);
      setRadarCounters(emptyRadarClientCounters());
      return;
    }
    setRadarCounters(loadRadarClientCounters(activeUserId));
    let cancelled = false;
    void loadRadarStore(activeUserId).then((state) => {
      if (!cancelled) {
        radarStoreRef.current = state;
        setRadarStore(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeUserId]);

  useEffect(() => {
    radarStoreRef.current = radarStore;
  }, [radarStore]);

  const local = useQuery({
    queryKey: ["local-messages", activeUserId, conversationId],
    queryFn: () => conversationPlaintext(conversationId),
    enabled: Boolean(conversationId && activeUserId) && isUnlocked(),
  });
  const activeDeviceId = isUnlocked() ? currentDeviceId() : null;
  const storedLocalMessages = local.data ?? emptyLocalMessages;
  const localMessages = useMemo(
    () => dedupeLogicalMessages(storedLocalMessages.map((message) => ({
        ...message,
        fromMe: isMessageFromUser(
          message.senderUserId,
          message.senderDeviceId,
          activeUserId,
          activeDeviceId,
        ),
      }))),
    [activeDeviceId, activeUserId, storedLocalMessages],
  );
  const assistantMessages = useMemo(
    () => localMessages.map(localMessageForAssistant),
    [localMessages],
  );
  const visibleMessages = useMemo(
    () => dedupeLogicalMessages([...olderMessages, ...localMessages]),
    [localMessages, olderMessages],
  );
  const selectedSpeechLanguage =
    assistantSettings?.language === "arabic" ||
    (assistantSettings?.language === "auto" &&
      speechLanguage(localMessages[localMessages.length - 1]?.plaintext ?? "") === "ar")
      ? "ar-JO"
      : "en-US";
  const selectedSpeechInputAvailable =
    selectedSpeechLanguage === "ar-JO"
      ? localSpeechInputAvailability.arabic
      : localSpeechInputAvailability.english;
  const latestIncomingId = latestIncomingMessageId(localMessages);
  const latestLocalMessageId = localMessages[localMessages.length - 1]?.id ?? null;
  const currentSuggestionKey =
    assistantSettings?.enabled && latestIncomingId
      ? [
          conversationId,
          latestIncomingId,
          assistantSettings.language,
          assistantSettings.tone,
          suggestionRetry,
        ].join(":")
      : null;

  useEffect(() => {
    const urls: string[] = [];
    selectedPhotos.forEach((file, index) => {
      const preview = selectedPhotoPreviewRefs.current[index];
      if (!preview) return;
      const url = URL.createObjectURL(file);
      preview.src = url;
      urls.push(url);
    });
    return () => {
      selectedPhotoPreviewRefs.current.forEach((preview) => {
        preview?.removeAttribute("src");
      });
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [selectedPhotos]);

  useEffect(() => {
    const preview = selectedVideoPreviewRef.current;
    if (!selectedVideo || !preview) return;
    const url = URL.createObjectURL(selectedVideo);
    preview.src = url;
    return () => {
      preview.pause();
      preview.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [selectedVideo]);

  useEffect(() => {
    const preview = selectedAudioPreviewRef.current;
    if (!selectedVoiceNote || !preview) return;
    const url = URL.createObjectURL(selectedVoiceNote.file);
    preview.src = url;
    return () => {
      preview.pause();
      preview.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [selectedVoiceNote]);

  useEffect(() => {
    if (!local.isSuccess) return;
    if (!latestLocalMessageId) {
      latestScrolledMessageId.current = null;
      return;
    }
    if (latestScrolledMessageId.current === latestLocalMessageId) return;

    latestScrolledMessageId.current = latestLocalMessageId;
    requestAnimationFrame(() => {
      const scroller = chatScrollRef.current;
      if (!scroller) return;
      scroller.scrollTop = scroller.scrollHeight;
    });
  }, [latestLocalMessageId, local.isSuccess]);

  useLayoutEffect(() => {
    const pending = pendingHistoryScroll.current;
    const scroller = chatScrollRef.current;
    if (!pending || !scroller) return;
    scroller.scrollTop = pending.top + scroller.scrollHeight - pending.height;
    pendingHistoryScroll.current = null;
  }, [visibleMessages.length]);

  async function loadOlderMessages() {
    const oldest = visibleMessages[0];
    const scroller = chatScrollRef.current;
    if (!oldest || !scroller || loadingOlderMessages || !hasOlderMessages) return;

    setLoadingOlderMessages(true);
    setHistoryLoadError(null);
    pendingHistoryScroll.current = {
      height: scroller.scrollHeight,
      top: scroller.scrollTop,
    };

    try {
      let older = await conversationPlaintext(
        conversationId,
        50,
        oldest,
      );
      if (older.length < 50) {
        const { messages } = await api.messages(
          conversationId,
          currentDeviceId(),
          oldest,
        );
        await ingestWireMessages(messages);
        older = await conversationPlaintext(
          conversationId,
          50,
          oldest,
        );
        await queryClient.invalidateQueries({
          queryKey: ["local-messages", activeUserId, conversationId],
        });
        setHasOlderMessages(messages.length >= 50 || older.length >= 50);
      } else {
        setHasOlderMessages(true);
      }

      if (older.length === 0) {
        pendingHistoryScroll.current = null;
        setHasOlderMessages(false);
        return;
      }

      setOlderMessages((current) => {
        const combined = new Map(
          [...older, ...current].map((message) => [message.id, message]),
        );
        return [...combined.values()].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
      });
    } catch (error) {
      pendingHistoryScroll.current = null;
      setHistoryLoadError(
        error instanceof Error
          ? error.message
          : "Could not load earlier messages. Please retry.",
      );
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  const getSpeechQueue = useCallback(() => {
    if (!speechQueueRef.current) {
      speechQueueRef.current = createSpeechQueue(
        createBrowserSpeechProvider(),
      );
    }
    return speechQueueRef.current;
  }, []);

  useEffect(() => {
    return () => {
      companionController.current?.abort();
      speechInputController.current?.abort();
      speechQueueRef.current?.cancel();
    };
  }, [companionRuntime, conversationId]);

  useEffect(() => {
    companionRuntime.dispatch({ type: "mount" });
    companionRuntime.dispatch({ type: "conversation-selected", conversationId });
    return () => companionRuntime.dispatch({ type: "dispose" });
  }, [companionRuntime, conversationId]);

  useEffect(() => {
    companionRuntime.dispatch({
      type: "settings-updated",
      settings: {
        enabled: assistantSettings?.enabled ?? false,
        proactiveObservations:
          assistantSettings?.proactiveObservations ?? false,
        mode: assistantSettings?.companionMode ?? "quiet",
        language: assistantSettings?.language ?? "auto",
      },
    });
  }, [
    assistantSettings?.companionMode,
    assistantSettings?.enabled,
    assistantSettings?.language,
    assistantSettings?.proactiveObservations,
    companionRuntime,
  ]);

  useEffect(() => {
    if (local.isSuccess) {
      companionRuntime.dispatch({
        type: "messages-loaded",
        conversationId,
        messages: assistantMessages,
      });
    }
  }, [assistantMessages, companionRuntime, conversationId, local.isSuccess]);

  useEffect(() => {
    radarRuntime.dispatch({ type: "mount" });
    radarRuntime.dispatch({
      type: "conversation-selected",
      conversationId,
    });
    return () => radarRuntime.dispatch({ type: "dispose" });
  }, [conversationId, radarRuntime]);

  useEffect(() => {
    radarRuntime.dispatch({
      type: "settings-updated",
      settings: {
        enabled: assistantSettings?.radarAnalysisEnabled === true,
        conversationAllowed: conversationRadarAllowed,
      },
    });
  }, [
    assistantSettings?.radarAnalysisEnabled,
    conversationRadarAllowed,
    radarRuntime,
  ]);

  useEffect(() => {
    if (local.isSuccess) {
      radarRuntime.dispatch({
        type: "messages-loaded",
        conversationId,
        messages: assistantMessages,
      });
    }
  }, [assistantMessages, conversationId, local.isSuccess, radarRuntime]);

  useEffect(() => {
    if (!assistantSettings?.enabled) {
      companionController.current?.abort();
      speechInputController.current?.abort();
      speechInputProvider.current.cancel();
      speechQueueRef.current?.cancel();
    }
  }, [assistantSettings?.enabled]);

  useEffect(() => {
    if (
      assistantSettings?.voiceMuted ||
      assistantSettings?.companionMode === "quiet"
    ) {
      speechQueueRef.current?.cancel();
    }
  }, [assistantSettings?.companionMode, assistantSettings?.voiceMuted]);

  useEffect(() => {
    if (
      companionController.current &&
      companionContextMessageId.current !== latestLocalMessageId
    ) {
      companionController.current.abort();
      speechQueueRef.current?.cancel();
    }
  }, [latestLocalMessageId]);

  const hasPlayingMedia = useCallback(() => {
    return Array.from(
      document.querySelectorAll<HTMLMediaElement>("audio, video"),
    ).some(
      (media) => !media.paused && !media.ended && media.volume > 0,
    );
  }, []);

  const speakSuggestion = useCallback(async (
    text: string,
    key: string,
    automatic: boolean,
  ) => {
    if (!assistantSettings?.enabled || assistantSettings.voiceMuted) {
      return;
    }
    if (listeningForCompanion) {
      setSpeechNotice("Speech is paused while the microphone is listening.");
      return;
    }

    const provider = createBrowserSpeechProvider();
    const queue = getSpeechQueue();
    if (
      document.visibilityState !== "visible" ||
      (provider.isSpeaking() && !queue.isSpeaking()) ||
      hasPlayingMedia()
    ) {
      setSpeechNotice(
        "Speech was skipped because this tab is inactive or other audio is playing.",
      );
      return;
    }

    if (automatic && !isSafeSpeechText(text)) {
      setSpeechNotice(
        "Automatic speech was skipped because the suggested text may be sensitive.",
      );
      return;
    }

    setSpeechNotice(automatic ? "Speaking one suggestion locally…" : "Speaking locally…");
    companionRuntime.dispatch({
      type: "activity-updated",
      state: "speaking",
    });
    try {
      const spoken = await queue.speakOnce(key, {
        text,
        language: speechLanguage(text),
        voiceURI: assistantSettings.voiceURI,
        rate: assistantSettings.speechRate,
      });
      if (spoken) {
        setSpeechNotice("Finished speaking. The suggestion remains in the composer area.");
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setSpeechNotice(
          error instanceof Error
            ? error.message
            : "The local speech voice could not speak this suggestion.",
        );
      }
    } finally {
      companionRuntime.dispatch({
        type: "activity-updated",
        state: "idle",
      });
    }
  }, [
    assistantSettings,
    getSpeechQueue,
    hasPlayingMedia,
    listeningForCompanion,
    companionRuntime,
  ]);

  useEffect(() => {
    messagesRef.current = assistantMessages;
  }, [assistantMessages]);

  useEffect(() => {
    incomingSpeechTracker.current.observe(conversationId, latestIncomingId);
  }, [conversationId, latestIncomingId]);

  useEffect(() => {
    const provider = createBrowserSpeechProvider();
    const refreshVoices = () => setSpeechVoices(provider.getVoices());
    const timer = setTimeout(refreshVoices, 0);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    }

    return () => {
      clearTimeout(timer);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
      }
    };
  }, []);

  useEffect(() => {
    setBrowserSpeechSupported(
      speechInputProvider.current.supportsBrowserRecognition(),
    );
    let active = true;
    void Promise.all([
      speechInputProvider.current.isOnDeviceAvailable("en-US"),
      speechInputProvider.current.isOnDeviceAvailable("ar-JO"),
    ]).then(([english, arabic]) => {
      if (active) {
        setLocalSpeechInputAvailability({ english, arabic });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const cancelWhenHidden = () => {
      if (document.visibilityState !== "visible") {
        speechQueueRef.current?.cancel();
      }
    };
    const cancelForMedia = () => {
      speechQueueRef.current?.cancel();
    };
    document.addEventListener("visibilitychange", cancelWhenHidden);
    document.addEventListener("play", cancelForMedia, true);
    return () => {
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      document.removeEventListener("play", cancelForMedia, true);
    };
  }, []);

  useEffect(() => {
    summaryController.current?.abort();
    summaryController.current = null;

    return () => {
      summaryController.current?.abort();
    };
  }, [conversationId]);

  useEffect(() => {
    const timer = setTimeout(
      () => setAssistantSettings(loadAssistantSettings(activeUserId)),
      0,
    );
    return () => clearTimeout(timer);
  }, [activeUserId]);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => scheduler.cancel();
  }, []);

  useEffect(() => {
    if (
      !assistantSettings?.enabled ||
      assistantSettings.voiceMode === "silent" ||
      assistantSettings.voiceMuted ||
      !currentSuggestionKey ||
      !latestIncomingId
    ) {
      speechQueueRef.current?.cancel();
      return;
    }
    return () => speechQueueRef.current?.cancel();
  }, [
    assistantSettings?.enabled,
    assistantSettings?.voiceMode,
    assistantSettings?.voiceMuted,
    conversationId,
    currentSuggestionKey,
    latestIncomingId,
  ]);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (
      !assistantSettings?.enabled ||
      !latestIncomingId ||
      !currentSuggestionKey
    ) {
      scheduler.cancel();
      if (!assistantSettings?.enabled) {
        handledSuggestionKey.current = null;
      }
      return;
    }

    const key = currentSuggestionKey;
    if (handledSuggestionKey.current === key) {
      return;
    }

    scheduler.schedule(
      key,
      (signal) => {
        const request: SuggestionRequest = {
          conversationId,
          messages: messagesRef.current,
          language: assistantSettings.language,
          tone: assistantSettings.tone,
          draftVoice: draftVoiceForUser(currentUserId()),
        };
        return generateSuggestedReplies(
          request,
          localInferenceProvider,
          {
            signal,
            onProgress: (progress) =>
              setSuggestionView((current) =>
                current?.key === key
                  ? { ...current, progress }
                  : current,
              ),
          },
        );
      },
      {
        onStart: () => {
          handledSuggestionKey.current = key;
          setSuggestionView({
            key,
            messageId: latestIncomingId,
            status: "loading",
            suggestions: [],
          });
        },
        onResult: (_key, suggestions) => {
          setSuggestionView({
            key,
            messageId: latestIncomingId,
            status: "ready",
            suggestions,
          });
        },
        onError: (_key, error) => {
          setSuggestionView({
            key,
            messageId: latestIncomingId,
            status: "error",
            suggestions: [],
            error: error.message,
          });
          const retryIdentity = [
            conversationId,
            latestIncomingId,
            assistantSettings.language,
            assistantSettings.tone,
          ].join(":");
          if (autoRetriedSuggestionKeys.current.claim(retryIdentity)) {
            retryTimer = setTimeout(() => {
              handledSuggestionKey.current = null;
              setSuggestionRetry((value) => value + 1);
            }, 800);
          }
        },
        onFinish: () => {
          setSuggestionView((current) =>
            current?.key === key && current.status === "loading"
              ? { ...current, status: "error", error: "Suggestions are unavailable right now. Try again." }
              : current,
          );
        },
      },
    );

    return () => {
      scheduler.cancel();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    assistantSettings?.enabled,
    assistantSettings?.language,
    assistantSettings?.tone,
    conversationId,
    currentSuggestionKey,
    latestIncomingId,
  ]);

  useEffect(() => {
    if (
      !assistantSettings?.enabled ||
      assistantSettings.voiceMode !== "automatic" ||
      assistantSettings.voiceMuted ||
      !currentSuggestionKey ||
      !latestIncomingId ||
      !incomingSpeechTracker.current.isEligible(
        conversationId,
        latestIncomingId,
      ) ||
      suggestionView?.key !== currentSuggestionKey ||
      suggestionView.status !== "ready" ||
      attemptedAutomaticSpeech.current.has(
        `${conversationId}:${latestIncomingId}`,
      )
    ) {
      return;
    }

    attemptedAutomaticSpeech.current.add(
      `${conversationId}:${latestIncomingId}`,
    );
    const canSpeak = canSpeakAutomatically({
      mode: assistantSettings.voiceMode,
      muted: assistantSettings.voiceMuted,
      visible: document.visibilityState === "visible",
      otherAudioPlaying:
        createBrowserSpeechProvider().isSpeaking() || hasPlayingMedia(),
      messages: assistantMessages,
    });
    const candidate = suggestionView.suggestions.find(
      isAllowedAutomaticSpeechText,
    );
    if (!canSpeak || !candidate) {
      const timer = window.setTimeout(
        () =>
          setSpeechNotice(
            "Automatic speech was skipped because the conversation may be sensitive, this tab is inactive, or other audio is playing.",
          ),
        0,
      );
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(
      () =>
        void speakSuggestion(
          candidate,
          `automatic:${conversationId}:${latestIncomingId}`,
          true,
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [
    assistantSettings,
    conversationId,
    currentSuggestionKey,
    hasPlayingMedia,
    incomingSpeechTracker,
    latestIncomingId,
    assistantMessages,
    speakSuggestion,
    suggestionView,
  ]);

  useQuery({
    queryKey: ["wire-messages", activeUserId, conversationId],
    queryFn: async () => {
      await syncConversationMessageDeletions(conversationId);
      const { messages } = await api.messages(
        conversationId,
        currentDeviceId(),
      );
      await ingestWireMessages(messages);
      await queryClient.invalidateQueries({
        queryKey: ["local-messages", activeUserId, conversationId],
      });
      return messages;
    },
    enabled: Boolean(conversationId) && isUnlocked(),
  });

  const deleteMessage = useMutation({
    mutationFn: async (message: LocalMessage) => {
      const logicalMessageId = message.logicalMessageId ?? message.id;
      await api.deleteMessage(conversationId, logicalMessageId);
      await applyRemoteMessageDeletion(
        conversationId,
        logicalMessageId,
        [message.id],
      );
    },
    onSuccess: async () => {
      setConfirmDeleteId(null);
      setDeleteMessageError(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["local-messages", activeUserId, conversationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["wire-messages", activeUserId, conversationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["conversations", activeUserId],
        }),
      ]);
    },
    onError: (error: unknown) => {
      setDeleteMessageError(
        error instanceof Error ? error.message : "The message could not be deleted.",
      );
    },
  });

  const form = useForm({
    resolver: zodResolver(messageSchema),
    defaultValues: { body: "" },
  });
  const composerBody = useWatch({
    control: form.control,
    name: "body",
  });
  const composerBodyRegistration = form.register("body");

  const send = useMutation({
    mutationFn: async (body: string) => {
      if (!conversation?.peer) throw new Error("Missing peer");
      if (!body.startsWith("PM1LOC:") && !body.startsWith("PM1RPL:")) {
        await assertOutgoingLinksSafe(body);
      }
      if (body.startsWith("PM1RPL:")) {
        const reply = parseChatPayload(body);
        if (reply.type === "reply") {
          await assertOutgoingLinksSafe(reply.body);
        }
      }
      const payload = await encryptOutgoing(conversationId, body);
      const result = await api.sendMessage(conversationId, payload);
      await storeSentMessage({
        id: result.logicalMessageId,
        conversationId,
        plaintext: body,
        createdAt: result.createdAt,
      });
    },
    onSuccess: () => {
      form.reset();
      setSelectedLocation(null);
      setSelectedReplyIds([]);
      setReplySelectMode(false);
      setSummary(null);
      setSentNotice(true);
      window.setTimeout(() => setSentNotice(false), 1600);
      void queryClient.invalidateQueries({
        queryKey: ["local-messages", activeUserId, conversationId],
      });
    },
  });
  const sendMedia = useMutation({
    mutationFn: async ({
      file,
      files,
      caption,
      kind,
      duration,
      fileAttachment,
    }: {
      file?: File;
      files?: File[];
      caption: string;
      kind: "photo" | "album" | "video" | "voice" | "file";
      duration?: number;
      fileAttachment?: PreparedFileAttachment;
    }) => {
      if (!conversation?.peer) throw new Error("Missing peer");
      await assertOutgoingLinksSafe(caption);

      if (kind === "album") {
        const albumFiles = files ?? [];
        if (albumFiles.length < 2) {
          throw new Error("Choose at least two photos for an album.");
        }
        if (albumFiles.length > maxAlbumPhotos) {
          throw new Error(`Albums can include at most ${maxAlbumPhotos} photos.`);
        }
        const items = [];
        for (const albumFile of albumFiles) {
          const encryptedPhoto = await encryptPhotoFile(albumFile);
          const ciphertext = encryptedPhoto.ciphertext;
          if (
            ciphertext.byteOffset !== 0 ||
            !(ciphertext.buffer instanceof ArrayBuffer) ||
            ciphertext.byteLength !== ciphertext.buffer.byteLength
          ) {
            throw new Error("The encrypted attachment could not be uploaded safely.");
          }
          const upload = await api.mediaUpload(
            conversationId,
            ciphertext.byteLength,
            "photo",
          );
          const uploadResponse = await fetch(upload.uploadUrl, {
            method: "PUT",
            headers: upload.headers,
            body: ciphertext.buffer,
          });
          if (!uploadResponse.ok) {
            throw new Error("The encrypted photo could not be uploaded.");
          }
          items.push({
            id: upload.mediaId,
            k: encryptedPhoto.key,
            n: encryptedPhoto.nonce,
            mime: encryptedPhoto.mime,
            w: encryptedPhoto.width,
            h: encryptedPhoto.height,
            bytes: ciphertext.byteLength,
          });
        }
        const body = encodeAlbumPayload({
          items,
          ...(caption.trim() ? { caption: caption.trim() } : {}),
        });
        const payload = await encryptOutgoing(conversationId, body);
        const result = await api.sendMessage(conversationId, payload);
        await storeSentMessage({
          id: result.logicalMessageId,
          conversationId,
          plaintext: body,
          createdAt: result.createdAt,
        });
        return;
      }

      let ciphertext: Uint8Array;
      let createMessageBody: (mediaId: string) => string;
      if (kind === "photo") {
        if (!file) throw new Error("The photo is missing.");
        const encryptedPhoto = await encryptPhotoFile(file);
        ciphertext = encryptedPhoto.ciphertext;
        createMessageBody = (mediaId) => encodeImagePayload({
          id: mediaId,
          k: encryptedPhoto.key,
          n: encryptedPhoto.nonce,
          mime: encryptedPhoto.mime,
          w: encryptedPhoto.width,
          h: encryptedPhoto.height,
          bytes: ciphertext.byteLength,
          ...(caption.trim() ? { caption: caption.trim() } : {}),
        });
      } else if (kind === "video") {
        if (!file) throw new Error("The video is missing.");
        const encryptedVideo = await encryptVideoFile(file);
        ciphertext = encryptedVideo.ciphertext;
        createMessageBody = (mediaId) => encodeVideoPayload({
          id: mediaId,
          k: encryptedVideo.key,
          n: encryptedVideo.nonce,
          mime: encryptedVideo.mime,
          duration: encryptedVideo.duration,
          bytes: ciphertext.byteLength,
          ...(caption.trim() ? { caption: caption.trim() } : {}),
        });
      } else if (kind === "voice") {
        if (!file) throw new Error("The voice note is missing.");
        if (duration === undefined) {
          throw new Error("The voice note duration is missing.");
        }
        const mime = file.type.includes("ogg")
          ? "audio/ogg"
          : file.type.includes("mp4")
            ? "audio/mp4"
            : "audio/webm";
        const encryptedVoiceNote = await encryptVoiceNoteBytes(
          new Uint8Array(await file.arrayBuffer()),
          mime,
          duration,
        );
        ciphertext = encryptedVoiceNote.ciphertext;
        createMessageBody = (mediaId) => encodeVoicePayload({
          id: mediaId,
          k: encryptedVoiceNote.key,
          n: encryptedVoiceNote.nonce,
          mime: encryptedVoiceNote.mime,
          duration,
          bytes: ciphertext.byteLength,
          ...(caption.trim() ? { caption: caption.trim() } : {}),
        });
      } else {
        if (!fileAttachment) throw new Error("The encrypted file attachment is missing.");
        ciphertext = fileAttachment.ciphertext;
        createMessageBody = (mediaId) => encodeFilePayload({
          id: mediaId,
          k: fileAttachment.key,
          n: fileAttachment.nonce,
          name: fileAttachment.name,
          mime: fileAttachment.mime,
          bytes: ciphertext.byteLength,
          containsExternalLinks: fileAttachment.containsExternalLinks,
          ...(caption.trim() ? { caption: caption.trim() } : {}),
        });
      }

      const uploadKind =
        kind === "photo" || kind === "video" || kind === "voice" || kind === "file"
          ? kind
          : "photo";
      const upload = await api.mediaUpload(
        conversationId,
        ciphertext.byteLength,
        uploadKind,
      );
      if (
        ciphertext.byteOffset !== 0 ||
        !(ciphertext.buffer instanceof ArrayBuffer) ||
        ciphertext.byteLength !== ciphertext.buffer.byteLength
      ) {
        throw new Error("The encrypted attachment could not be uploaded safely.");
      }
      const uploadResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: ciphertext.buffer,
      });
      if (!uploadResponse.ok) {
        throw new Error(`The encrypted ${kind} could not be uploaded.`);
      }

      const body = createMessageBody(upload.mediaId);
      const payload = await encryptOutgoing(conversationId, body);
      const result = await api.sendMessage(conversationId, payload);
      await storeSentMessage({
        id: result.logicalMessageId,
        conversationId,
        plaintext: body,
        createdAt: result.createdAt,
      });
    },
    onSuccess: () => {
      setSelectedPhotos([]);
      setSelectedVideo(null);
      setSelectedVoiceNote(null);
      setSelectedFile(null);
      setSelectedLocation(null);
      form.reset();
      setSummary(null);
      setSentNotice(true);
      window.setTimeout(() => setSentNotice(false), 1600);
      void queryClient.invalidateQueries({
        queryKey: ["local-messages", activeUserId, conversationId],
      });
    },
  });
  const sendMessageRef = useRef<(body: string) => Promise<void>>(
    async () => {
      throw new Error("Message sending is not ready.");
    },
  );

  useEffect(() => {
    sendMessageRef.current = send.mutateAsync;
  }, [send]);

  useEffect(() => {
    const runtime = createAgentRuntime({
      getContext: () => ({
        conversationId,
        recipientUsername: conversation?.peer?.username ?? null,
      }),
      handlers: {
        sendMessage: async (action) => {
          if (form.getValues("body") !== action.body) {
            throw new Error("The draft changed after approval. Review and confirm the exact message again.");
          }
          await sendMessageRef.current(action.body);
        },
        webSearch: (action) => {
          const url = buildApprovedSearchUrl(action.query);
          window.open(url, "_blank", "noopener,noreferrer");
          setApprovedSearchUrl(url);
        },
        ui: (action) => {
          if (action.action === "open_companion") {
            setCompanionOpen(true);
          } else {
            setCompanionObservation(null);
          }
        },
        createDocument: async (action) => {
          await downloadSophiaDocument(action);
        },
        rememberFact: (action) => {
          if (!activeUserId) {
            throw new Error("Sign in before storing personal notes.");
          }
          const next = addMemoryFact(
            loadPersonalMemory(activeUserId),
            action.fact,
          );
          if (!savePersonalMemory(activeUserId, next)) {
            throw new Error("Could not save personal memory in this browser.");
          }
          setPersonalMemory(next);
        },
        forgetFact: (action) => {
          if (!activeUserId) {
            throw new Error("Sign in before changing personal notes.");
          }
          const next = removeMemoryFact(loadPersonalMemory(activeUserId), {
            text: action.query,
          });
          if (!savePersonalMemory(activeUserId, next)) {
            throw new Error("Could not update personal memory in this browser.");
          }
          setPersonalMemory(next);
        },
        draftMessage: (action) => {
          form.setValue("body", action.body, {
            shouldDirty: true,
            shouldTouch: true,
          });
        },
        acceptFinding: async (action) => {
          if (!activeUserId) {
            throw new Error("Sign in before saving Radar tasks.");
          }
          const next = acceptFindingAsTaskDraft(
            radarStoreRef.current,
            action.findingId,
            {
              title: action.title,
              dueAt: action.dueAt,
            },
          );
          radarStoreRef.current = next;
          setRadarStore(next);
          setRadarFindingEdits((edits) => {
            const copy = { ...edits };
            delete copy[action.findingId];
            return copy;
          });
          if (!(await saveRadarStore(activeUserId, next))) {
            throw new Error("Could not save the local Radar task in this browser.");
          }
          setRadarCounters((previous) => {
            const bumped = bumpRadarCounter(previous, "findingsAccepted");
            saveRadarClientCounters(activeUserId, bumped);
            return bumped;
          });
          const draft = next.taskDrafts.find(
            (item) => item.findingId === action.findingId,
          );
          if (draft) {
            try {
              await syncAcceptedTaskDraft(draft, (payload) =>
                api.createTask(payload),
              );
            } catch (error) {
              setRadarStoreError(
                error instanceof Error
                  ? `Saved locally, but server sync failed: ${error.message}`
                  : "Saved locally, but server sync failed.",
              );
            }
          }
        },
        dismissFinding: async (action) => {
          if (!activeUserId) {
            throw new Error("Sign in before updating Radar findings.");
          }
          const next = dismissFinding(radarStoreRef.current, action.findingId);
          radarStoreRef.current = next;
          setRadarStore(next);
          setRadarFindingEdits((edits) => {
            const copy = { ...edits };
            delete copy[action.findingId];
            return copy;
          });
          if (!(await saveRadarStore(activeUserId, next))) {
            throw new Error("Could not update Radar findings in this browser.");
          }
          setRadarCounters((previous) => {
            const bumped = bumpRadarCounter(previous, "findingsDismissed");
            saveRadarClientCounters(activeUserId, bumped);
            return bumped;
          });
        },
        snoozeReminder: async (action) => {
          if (!activeUserId) {
            throw new Error("Sign in before snoozing Radar reminders.");
          }
          const next = snoozeFinding(
            radarStoreRef.current,
            action.findingId,
            action.until,
          );
          radarStoreRef.current = next;
          setRadarStore(next);
          if (!(await saveRadarStore(activeUserId, next))) {
            throw new Error("Could not snooze this Radar reminder in this browser.");
          }
        },
        draftEmail: async (action, approval) => {
          if (!approval?.proposalId) {
            throw new Error("Email changes run only after explicit approval.");
          }
          const payload = emailApiPayload(action);
          if (action.delivery === "send") {
            await api.sendEmail(action.provider, payload, approval.proposalId);
            return;
          }
          await api.createEmailDraft(action.provider, payload, approval.proposalId);
        },
        createCalendarEvent: async (action) => {
          await api.createCalendarEvent(action.provider, {
            title: action.title,
            startsAt: action.startsAt,
            endsAt: action.endsAt,
            allDay: action.allDay,
            description: action.description,
          });
        },
        deleteCalendarEvent: async (action, approval) => {
          if (!approval?.proposalId) {
            throw new Error("Calendar deletes run only after explicit approval.");
          }
          await api.deleteCalendarEvent(
            action.provider,
            action.eventId,
            approval.proposalId,
          );
        },
        createGitHubIssue: async (action) => {
          await api.createGitHubIssue({
            owner: action.owner,
            repo: action.repo,
            title: action.title,
            body: action.body,
          });
        },
        createLinearIssue: async (action) => {
          await api.createLinearIssue({
            title: action.title,
            teamId: action.teamId,
            description: action.description,
          });
        },
        postSlackMessage: async (action) => {
          await api.postSlackMessage({
            channelId: action.channelId,
            text: action.text,
          });
        },
        proposeFollowUp: async (action) => {
          if (!activeUserId) {
            throw new Error("Sign in before saving follow-ups.");
          }
          const next = createFollowUpTaskDraft(radarStoreRef.current, {
            title: action.title,
            dueAt: action.dueAt,
            conversationId: action.conversationId ?? conversationId,
            findingId: action.sourceFindingId,
          });
          radarStoreRef.current = next;
          setRadarStore(next);
          if (!(await saveRadarStore(activeUserId, next))) {
            throw new Error("Could not save the follow-up on this device.");
          }
          const draft = next.taskDrafts[0];
          if (draft) {
            try {
              await api.createTask({
                title: draft.title,
                dueAt: draft.dueAt,
                source: "RADAR",
                clientDraftId: draft.id,
                conversationId: draft.conversationId,
              });
            } catch (error) {
              setRadarStoreError(
                error instanceof Error
                  ? `Saved locally, but server sync failed: ${error.message}`
                  : "Saved locally, but server sync failed.",
              );
            }
          }
        },
        rescheduleCommitment: async (action, approval) => {
          if (!activeUserId) {
            throw new Error("Sign in before rescheduling commitments.");
          }
          const next = updateTaskDraft(radarStoreRef.current, action.taskDraftId, {
            title: action.title,
            dueAt: action.dueAt,
          });
          radarStoreRef.current = next;
          setRadarStore(next);
          if (!(await saveRadarStore(activeUserId, next))) {
            throw new Error("Could not reschedule this local commitment.");
          }
          if (
            action.calendarProvider &&
            action.externalEventId &&
            action.startsAt &&
            action.endsAt
          ) {
            if (!approval?.proposalId) {
              throw new Error("Calendar reschedules run only after explicit approval.");
            }
            await api.updateCalendarEvent(
              action.calendarProvider,
              action.externalEventId,
              {
                title: action.title,
                startsAt: action.startsAt,
                endsAt: action.endsAt,
              },
              approval.proposalId,
            );
          }
        },
      },
      onProposalsChanged: setAgentProposals,
    });
    agentRuntimeRef.current = runtime;
    return () => {
      runtime.cancelAll();
      agentRuntimeRef.current = null;
    };
  }, [
    activeUserId,
    conversation?.peer?.username,
    conversationId,
    form,
  ]);

  function handleMessageSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (send.isPending || sendMedia.isPending || locating) return;
    if (selectedPhotos.length || selectedVideo || selectedVoiceNote || selectedFile) {
      const caption = form.getValues("body");
      if (caption.length > 4000) {
        setPhotoError("Media captions must be 4,000 characters or fewer.");
        return;
      }
      setPhotoError(null);
      if (selectedPhotos.length > 1) {
        sendMedia.mutate({
          files: selectedPhotos,
          caption,
          kind: "album",
        });
        return;
      }
      const file =
        selectedPhotos[0] ??
        selectedVideo ??
        selectedVoiceNote?.file ??
        selectedFile?.file;
      if (!file) return;
      sendMedia.mutate({
        file,
        caption,
        kind: selectedFile
          ? "file"
          : selectedVoiceNote
            ? "voice"
            : selectedVideo
              ? "video"
              : "photo",
        ...(selectedVoiceNote ? { duration: selectedVoiceNote.duration } : {}),
        ...(selectedFile ? { fileAttachment: selectedFile.encrypted } : {}),
      });
      return;
    }

    if (selectedLocation) {
      const caption = form.getValues("body").trim();
      if (caption.length > 4000) {
        setPhotoError("Location captions must be 4,000 characters or fewer.");
        return;
      }
      setPhotoError(null);
      setAgentActionError(null);
      send.mutate(
        encodeLocationPayload({
          lat: selectedLocation.lat,
          lon: selectedLocation.lon,
          sharedAt: selectedLocation.sharedAt,
          ...(typeof selectedLocation.accuracy === "number"
            ? { accuracy: selectedLocation.accuracy }
            : {}),
          ...(typeof selectedLocation.altitude === "number"
            ? { altitude: selectedLocation.altitude }
            : {}),
          ...(caption ? { caption } : {}),
        }),
      );
      return;
    }

    void form.trigger("body").then((valid) => {
      if (!valid) return;
      setAgentActionError(null);
      const bodyText = form.getValues("body").trim();
      if (outgoingTextDestination("composer") !== "chat") return;
      if (selectedReplyIds.length > 0) {
        const refs = selectedReplyIds
          .map((id) => visibleMessages.find((message) => message.id === id))
          .filter((message): message is LocalMessage => Boolean(message))
          .slice(0, 8)
          .map((message) => ({
            id: message.logicalMessageId ?? message.id,
            preview: messagePreviewText(message.plaintext),
            fromMe: message.fromMe,
          }));
        if (!refs.length) {
          setPhotoError("Select at least one message to reply to.");
          return;
        }
        send.mutate(encodeReplyPayload({ refs, body: bodyText }));
        return;
      }
      send.mutate(form.getValues("body"));
    });
  }

  async function shareCurrentLocation() {
    if (locating || send.isPending || sendMedia.isPending) {
      return;
    }
    setAttachmentMenuOpen(false);
    setPhotoError(null);
    setLocating(true);
    try {
      const location = await readBrowserLocation();
      setSelectedPhotos([]);
      setSelectedVideo(null);
      setSelectedVoiceNote(null);
      setSelectedFile(null);
      setSelectedLocation(location);
      form.setValue("body", "", {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: true,
      });
    } catch (error) {
      setSelectedLocation(null);
      setPhotoError(
        error instanceof Error
          ? error.message
          : "Could not read your location.",
      );
    } finally {
      setLocating(false);
    }
  }

  function handlePhotoSelection(event: React.ChangeEvent<HTMLInputElement>) {
    videoSelectionRequest.current += 1;
    fileSelectionRequest.current += 1;
    setPreparingFile(false);
    const files = [...(event.currentTarget.files ?? [])].slice(0, maxAlbumPhotos);
    event.currentTarget.value = "";
    setPhotoError(null);
    sendMedia.reset();
    setSelectedVoiceNote(null);
    setSelectedFile(null);
    setSelectedLocation(null);
    setSelectedVideo(null);
    if (!files.length) {
      setSelectedPhotos([]);
      setPhotoEditorOpen(false);
      return;
    }
    if (files.some((file) => file.size > maxPhotoBytes)) {
      setSelectedPhotos([]);
      setPhotoEditorOpen(false);
      setPhotoError("Each photo must be 6 MB or smaller.");
      return;
    }
    if (files.length > maxAlbumPhotos) {
      setPhotoError(`You can send up to ${maxAlbumPhotos} photos in one message.`);
    }
    setSelectedPhotos(files);
    setPhotoEditorOpen(files.length === 1);
  }

  async function handleVideoSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const requestId = ++videoSelectionRequest.current;
    fileSelectionRequest.current += 1;
    setPreparingFile(false);
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setPhotoError(null);
    setSelectedPhotos([]);
    setSelectedVoiceNote(null);
    setSelectedFile(null);
    setSelectedLocation(null);
    setSelectedVideo(null);
    sendMedia.reset();
    if (!file) return;
    if (file.size > maxVideoSourceBytes) {
      setPhotoError("Videos must be 500 MB or smaller before compression.");
      return;
    }

    try {
      await readVideoDuration(file);
      if (videoSelectionRequest.current === requestId) setSelectedVideo(file);
    } catch (error) {
      if (videoSelectionRequest.current === requestId) {
        setPhotoError(
          error instanceof Error ? error.message : "Could not read this video.",
        );
      }
    }
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const requestId = ++fileSelectionRequest.current;
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setPhotoError(null);
    sendMedia.reset();
    setSelectedPhotos([]);
    setSelectedVideo(null);
    setSelectedVoiceNote(null);
    setSelectedFile(null);
    setSelectedLocation(null);
    if (!file) {
      setPreparingFile(false);
      return;
    }
    if (file.size === 0 || file.size > maxFileAttachmentBytes) {
      setPhotoError("Files must be non-empty and 450 MB or smaller.");
      return;
    }

    try {
      sanitizeAttachmentName(file.name);
      setPreparingFile(true);
      const encrypted = await inspectAndEncryptFileAttachment(file);
      if (fileSelectionRequest.current === requestId) {
        setSelectedFile({ file, encrypted });
      }
    } catch (error) {
      if (fileSelectionRequest.current === requestId) {
        setPhotoError(
          error instanceof Error ? error.message : "The selected file could not be verified.",
        );
      }
    } finally {
      if (fileSelectionRequest.current === requestId) setPreparingFile(false);
    }
  }

  function insertComposerEmoji(emoji: string) {
    const input = composerInputRef.current;
    const body = form.getValues("body");
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? body.length;
    const updatedBody = `${body.slice(0, start)}${emoji}${body.slice(end)}`;

    form.setValue("body", updatedBody, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function flashApproveSuccess(proposal: AgentProposal) {
    if (approveFlashTimer.current !== null) {
      window.clearTimeout(approveFlashTimer.current);
    }
    setApproveFlash(`Approved · ${agentActionSummary(proposal.action)}`);
    approveFlashTimer.current = window.setTimeout(() => {
      setApproveFlash(null);
      approveFlashTimer.current = null;
    }, 2_400);
  }

  function insertCompanionHint(text: string) {
    setCompanionInput((current) => {
      const trimmedStart = current.trimStart();
      if (trimmedStart.startsWith("/")) {
        return text;
      }
      if (!current.trim()) {
        return text;
      }
      if (/\s$/.test(current)) {
        return `${current}${text}`;
      }
      return `${current} ${text}`;
    });
  }

  async function approveAgentProposal(proposal: AgentProposal) {
    if (
      proposal.action.type === "send_message" &&
      form.getValues("body") !== proposal.action.body
    ) {
      agentRuntimeRef.current?.cancel(proposal.id);
      setAgentActionError(
        "The message changed after it was prepared. Review the updated text and press Send to request fresh approval.",
      );
      return;
    }
    try {
      setAgentActionError(null);
      await agentRuntimeRef.current?.approve(proposal.id);
      flashApproveSuccess(proposal);
      if (proposal.action.type === "send_message") {
        setAgentActionError(null);
      }
    } catch (error) {
      setAgentActionError(
        error instanceof Error
          ? localizedRuntimeMessage(error.message, t)
          : t("approval.failed"),
      );
    }
  }

  function cancelAgentProposal(proposal: AgentProposal) {
    agentRuntimeRef.current?.cancel(proposal.id);
  }

  function proposeResearch(query: string) {
    try {
      setAgentActionError(null);
      agentRuntimeRef.current?.propose({
        type: "web_search",
        query: query.trim(),
        provider: "duckduckgo",
      });
    } catch (error) {
      setAgentActionError(
        error instanceof Error ? error.message : "Could not prepare the search.",
      );
    }
  }

  function refreshRadarBriefing() {
    const briefing = buildDailyBriefing(radarStoreRef.current, {
      conversationId: conversationRadarAllowed ? conversationId : null,
      peerUsername: conversation?.peer?.username ?? null,
    });
    setRadarBriefing(briefing);
    if (activeUserId) {
      setRadarCounters((previous) => {
        const bumped = bumpRadarCounter(previous, "briefingsGenerated");
        saveRadarClientCounters(activeUserId, bumped);
        return bumped;
      });
    }
    return briefing;
  }

  function proposeSophiaIntents(intents: SophiaIntent[]) {
    const runtime = agentRuntimeRef.current;
    const actionable = intents.filter((intent) => intent.type !== "radar_answer");
    if (!actionable.length) {
      return;
    }
    if (!runtime) {
      throw new Error("Sophia actions are not ready yet.");
    }
    const recipientUsername = conversation?.peer?.username;
    const defaults = jobDefaultsRef.current;
    const commandOpts = { provenance: "command" as const };
    for (const intent of actionable) {
      switch (intent.type) {
        case "create_document":
          runtime.propose(
            {
              type: "create_document",
              filename: intent.document.filename,
              title: intent.document.title,
              body: intent.document.body,
              mimeType: intent.document.mimeType,
              ...(intent.document.presentation
                ? { presentation: intent.document.presentation }
                : {}),
            },
            commandOpts,
          );
          break;
        case "research":
          runtime.propose(
            {
              type: "web_search",
              query: intent.query,
              provider: "duckduckgo",
            },
            commandOpts,
          );
          break;
        case "draft_message":
          if (!recipientUsername) {
            throw new Error("Select a conversation before drafting a message.");
          }
          runtime.propose(
            {
              type: "draft_message",
              conversationId,
              recipientUsername,
              body: intent.body,
            },
            commandOpts,
          );
          break;
        case "remember_fact":
          runtime.propose(
            {
              type: "remember_fact",
              fact: intent.fact,
            },
            commandOpts,
          );
          break;
        case "forget_fact":
          runtime.propose(
            {
              type: "forget_fact",
              query: intent.query,
            },
            commandOpts,
          );
          break;
        case "draft_email":
          runtime.propose(
            {
              type: "draft_email",
              provider: intent.provider,
              to: intent.to,
              subject: intent.subject,
              body: intent.body,
              ...(intent.cc ? { cc: intent.cc } : {}),
              ...(intent.delivery ? { delivery: intent.delivery } : {}),
            },
            commandOpts,
          );
          break;
        case "create_calendar_event":
          runtime.propose(
            {
              type: "create_calendar_event",
              provider: intent.provider,
              title: intent.title,
              startsAt: intent.startsAt,
              endsAt: intent.endsAt,
              allDay: intent.allDay,
              description: intent.description,
            },
            commandOpts,
          );
          break;
        case "create_github_issue":
          runtime.propose(
            {
              type: "create_github_issue",
              owner: intent.owner,
              repo: intent.repo,
              title: intent.title,
              body: intent.body,
            },
            commandOpts,
          );
          break;
        case "create_linear_issue": {
          const teamId = intent.teamId?.trim() || defaults.linearTeamId?.trim();
          if (!teamId) {
            throw new Error(
              "Set a Linear team id in Sophia job defaults before filing Linear issues.",
            );
          }
          runtime.propose(
            {
              type: "create_linear_issue",
              title: intent.title,
              teamId,
              description: intent.description,
            },
            commandOpts,
          );
          break;
        }
        case "post_slack_message": {
          const channelId =
            intent.channelId?.trim() || defaults.slackChannelId?.trim();
          if (!channelId) {
            throw new Error(
              "Set a Slack channel id in Sophia job defaults (or connect Slack mirrors) before posting.",
            );
          }
          runtime.propose(
            {
              type: "post_slack_message",
              channelId,
              channelName: intent.channelName ?? defaults.slackChannelName,
              text: intent.text,
            },
            commandOpts,
          );
          break;
        }
        case "propose_follow_up":
          runtime.propose(
            {
              type: "propose_follow_up",
              title: intent.title,
              dueAt: intent.dueAt,
              conversationId: intent.conversationId ?? conversationId,
              sourceFindingId: intent.sourceFindingId,
              notes: intent.notes,
            },
            commandOpts,
          );
          break;
        case "reschedule_commitment":
          runtime.propose(
            {
              type: "reschedule_commitment",
              taskDraftId: intent.taskDraftId,
              title: intent.title,
              dueAt: intent.dueAt,
              previousDueAt: intent.previousDueAt,
            },
            commandOpts,
          );
          break;
      }
    }
  }

  function proposeAgentAction(
    action: AgentToolAction,
    provenance: AgentProposalProvenance = "companion",
  ) {
    const runtime = agentRuntimeRef.current;
    if (!runtime) {
      setAgentActionError("Sophia actions are not ready yet.");
      return;
    }
    try {
      runtime.propose(action, { provenance });
      setAgentActionError(null);
      if (isJobManagerTool(action.type)) {
        setCompanionOpen(false);
        setActivitySheet(null);
      } else {
        setCompanionOpen(true);
      }
    } catch (error) {
      setAgentActionError(
        error instanceof Error
          ? error.message
          : "Could not stage that Sophia action.",
      );
    }
  }

  function proposeDeadlineActions() {
    const actions = buildDeadlineProposals(radarStoreRef.current, {
      conversationId: conversationRadarAllowed ? conversationId : null,
    });
    if (!actions.length) {
      setAgentActionError("No due-soon or overdue local commitments to stage.");
      return;
    }
    for (const action of actions.slice(0, 4)) {
      proposeAgentAction(action, "deadline");
    }
  }

  function proposeBriefingTaskAction(task: RadarTaskDraft) {
    const briefing =
      radarBriefing ??
      buildDailyBriefing(radarStoreRef.current, {
        conversationId: conversationRadarAllowed ? conversationId : null,
        peerUsername: conversation?.peer?.username ?? null,
      });
    const action = buildBriefingStagedAction(briefing, {
      task,
      now: new Date(),
    });
    if (action) {
      proposeAgentAction(action, "briefing");
    }
  }

  function updateAssistantSettings(
    update: Partial<AssistantSettings>,
  ) {
    const previous = assistantSettings ?? defaultAssistantSettings;
    const next = {
      ...previous,
      ...update,
    };
    const companionGenerationChanged =
      next.enabled !== previous.enabled ||
      next.language !== previous.language ||
      next.tone !== previous.tone ||
      next.companionMode !== previous.companionMode ||
      next.voiceMuted !== previous.voiceMuted;
    if (companionGenerationChanged) {
      companionController.current?.abort();
      companionController.current = null;
      setCompanionBusy(false);
      setCompanionProgress(null);
      speechQueueRef.current?.cancel();
      companionRuntime.dispatch({ type: "cancel" });
    }
    if (
      next.voiceURI !== previous.voiceURI ||
      next.speechRate !== previous.speechRate
    ) {
      speechQueueRef.current?.cancel();
    }
    setAssistantSettings(next);
    if (
      !next.enabled ||
      !next.proactiveObservations ||
      next.companionMode === "quiet"
    ) {
      setCompanionObservation(null);
    }
    if (
      next.enabled !== previous.enabled ||
      next.language !== previous.language ||
      next.tone !== previous.tone
    ) {
      setSuggestionView(null);
    }
    setAssistantSettingsError(
      saveAssistantSettings(next, activeUserId)
        ? null
        : "Could not save assistant preferences in this browser.",
    );
  }

  async function persistRadarStore(next: RadarStoreState) {
    radarStoreRef.current = next;
    setRadarStore(next);
    if (!activeUserId) {
      setRadarStoreError("Sign in before changing Radar preferences.");
      return false;
    }
    const ok = await saveRadarStore(activeUserId, next);
    setRadarStoreError(
      ok ? null : "Could not save Radar preferences in this browser.",
    );
    return ok;
  }

  function proposeRadarFindingAction(
    finding: RadarFinding,
    kind: "accept" | "dismiss" | "snooze" | "secondary",
  ) {
    const runtime = agentRuntimeRef.current;
    if (!runtime) {
      setAgentActionError("Sophia actions are not ready yet.");
      return;
    }
    const edit = radarFindingEdits[finding.id];
    const radarOpts = { provenance: "radar" as const };
    try {
      if (kind === "accept") {
        runtime.propose(
          {
            type: "accept_finding",
            findingId: finding.id,
            title: (edit?.title ?? finding.title).trim() || finding.title,
            dueAt: (edit?.dueAt ?? finding.dueAt)?.trim() || undefined,
          },
          radarOpts,
        );
      } else if (kind === "dismiss") {
        runtime.propose(
          {
            type: "dismiss_finding",
            findingId: finding.id,
          },
          radarOpts,
        );
      } else if (kind === "secondary") {
        const secondaries = buildRadarSecondaryActions(
          {
            ...finding,
            title: (edit?.title ?? finding.title).trim() || finding.title,
            dueAt: (edit?.dueAt ?? finding.dueAt)?.trim() || finding.dueAt,
          },
          jobDefaultsRef.current,
        );
        for (const action of secondaries.slice(0, 3)) {
          runtime.propose(action, radarOpts);
        }
      } else {
        const until = new Date();
        until.setDate(until.getDate() + 1);
        runtime.propose(
          {
            type: "snooze_reminder",
            findingId: finding.id,
            until: until.toISOString(),
          },
          radarOpts,
        );
      }
      setAgentActionError(null);
      setCompanionOpen(true);
    } catch (error) {
      setAgentActionError(
        error instanceof Error
          ? error.message
          : "Could not stage that Radar action.",
      );
    }
  }

  function retrySuggestions() {
    if (!latestIncomingId) {
      return;
    }
    handledSuggestionKey.current = null;
    setSuggestionView(null);
    setSuggestionRetry((value) => value + 1);
  }

  function stopCompanion(cancelPendingObservation = true) {
    companionController.current?.abort();
    companionController.current = null;
    speechInputController.current?.abort();
    speechInputController.current = null;
    speechInputProvider.current.cancel();
    setCompanionBusy(false);
    setListeningForCompanion(false);
    setCompanionProgress(null);
    speechQueueRef.current?.cancel();
    if (cancelPendingObservation) {
      companionRuntime.dispatch({ type: "cancel" });
    }
  }

  async function startCompanionListening() {
    if (
      !microphoneEnabled ||
      (!selectedSpeechInputAvailable && !allowBrowserSpeech) ||
      listeningForCompanion
    ) {
      return;
    }
    const controller = new AbortController();
    speechInputController.current = controller;
    setListeningForCompanion(true);
    companionRuntime.dispatch({
      type: "user-input",
      source: "voice",
    });
    companionRuntime.dispatch({
      type: "activity-updated",
      state: "listening",
    });
    setCompanionError(null);
    const language = selectedSpeechLanguage;
    const previousInput = companionInput.trim();

    try {
      const transcript = await speechInputProvider.current.listen(language, {
        signal: controller.signal,
        allowBrowserService: allowBrowserSpeech,
        onInterim: (text) =>
          setCompanionInput([previousInput, text].filter(Boolean).join(" ")),
      });
      if (!controller.signal.aborted) {
        setCompanionInput([previousInput, transcript].filter(Boolean).join(" "));
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setCompanionError(
          error instanceof Error
            ? error.message
            : "On-device speech input is unavailable. You can type instead.",
        );
      }
    } finally {
      if (speechInputController.current === controller) {
        speechInputController.current = null;
        setListeningForCompanion(false);
        companionRuntime.dispatch({
          type: "activity-updated",
          state: "idle",
        });
      }
    }
  }

  async function sendCompanionMessage(input: string, retry = false) {
    input = input.trim();
    if (!input || !assistantSettings?.enabled) {
      return;
    }

    companionController.current?.abort();
    speechInputController.current?.abort();
    speechInputProvider.current.cancel();
    speechQueueRef.current?.cancel();
    schedulerRef.current.cancel();
    summaryController.current?.abort();
    const controller = new AbortController();
    companionController.current = controller;
    companionContextMessageId.current = latestLocalMessageId;
    const lastUserTurnIndex = retry
      ? companionTurns.map((turn) => turn.role).lastIndexOf("user")
      : -1;
    const existingAssistantTurn =
      retry && companionTurns[lastUserTurnIndex + 1]?.role === "assistant"
        ? companionTurns[lastUserTurnIndex + 1]
        : undefined;
    companionRuntime.dispatch({
      type: "user-input",
      source: "text",
    });
    companionRuntime.dispatch({
      type: "activity-updated",
      state: "thinking",
    });
    const assistantTurn: CompanionTurn = {
      id: existingAssistantTurn?.id ?? crypto.randomUUID(),
      role: "assistant",
      content: "",
      sources: undefined,
    };
    const history = retry
      ? companionTurns.slice(0, lastUserTurnIndex)
      : companionTurns;
    if (retry) {
      resetLocalInferenceProvider();
    }
    setCompanionTurns((turns) =>
      retry
        ? turns.map((turn) =>
            turn.id === assistantTurn.id
              ? { ...turn, content: "", sources: undefined }
              : turn,
          )
        : [
            ...turns,
            { id: crypto.randomUUID(), role: "user", content: input },
            assistantTurn,
          ],
    );
    setCompanionInput("");
    setListeningForCompanion(false);
    setCompanionBusy(true);
    setCompanionProgress(null);
    setCompanionError(null);

    if (!retry && assistantSettings.sophiaVoiceCommands) {
      const plan = parseSophiaCommand(input, {
        memories: assistantSettings.personalMemory ? personalMemory : [],
        recipientUsername: conversation?.peer?.username ?? null,
        radarStore: assistantSettings.radarAnalysisEnabled
          ? radarStoreRef.current
          : null,
        conversationId: conversationRadarAllowed ? conversationId : null,
        jobDefaults: jobDefaultsRef.current,
        voice: draftVoiceForUser(currentUserId()),
      });
      if (plan.intents.length > 0) {
        try {
          setAgentActionError(null);
          proposeSophiaIntents(plan.intents);
          if (
            plan.intents.some((intent) => intent.type === "radar_answer") &&
            activeUserId
          ) {
            setRadarCounters((previous) => {
              const bumped = bumpRadarCounter(previous, "questionsAnswered");
              saveRadarClientCounters(activeUserId, bumped);
              return bumped;
            });
          }
          const reply = plan.spokenReply;
          setCompanionTurns((turns) =>
            turns.map((turn) =>
              turn.id === assistantTurn.id ? { ...turn, content: reply } : turn,
            ),
          );
          companionRuntime.dispatch({
            type: "inference-completed",
            outcome: "success",
          });
          if (
            assistantSettings.companionMode === "active-voice" &&
            !assistantSettings.voiceMuted
          ) {
            await speakSuggestion(
              reply,
              `sophia-plan:${conversationId}:${assistantTurn.id}`,
              true,
            );
          }
        } catch (error) {
          companionRuntime.dispatch({
            type: "inference-completed",
            outcome: "error",
          });
          setCompanionError(
            error instanceof Error
              ? error.message
              : "Sophia could not stage those actions.",
          );
          setAgentActionError(
            error instanceof Error
              ? error.message
              : "Sophia could not stage those actions.",
          );
        } finally {
          if (companionController.current === controller) {
            companionController.current = null;
            setCompanionBusy(false);
            setCompanionProgress(null);
          }
        }
        return;
      }
    }

    const researchQuery = assistantSettings.automaticOnlineResearch
      ? getAutomaticResearchQuery(input)
      : null;

    try {
      let reply: string;
      if (researchQuery) {
        setResearching(true);
        const sources = await searchWeb(researchQuery, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setCompanionTurns((turns) =>
          turns.map((turn) =>
            turn.id === assistantTurn.id ? { ...turn, sources } : turn,
          ),
        );
        setResearching(false);
        reply = await generateResearchAnswer(
          {
            question: input,
            sources,
            language: assistantSettings.language,
            tone: assistantSettings.tone,
            draftVoice: draftVoiceForUser(currentUserId()),
          },
          localInferenceProvider,
          {
            signal: controller.signal,
            onProgress: setCompanionProgress,
            onReset: () =>
              setCompanionTurns((turns) =>
                turns.map((turn) =>
                  turn.id === assistantTurn.id
                    ? { ...turn, content: "" }
                    : turn,
                ),
              ),
            onChunk: (chunk) =>
              setCompanionTurns((turns) =>
                turns.map((turn) =>
                  turn.id === assistantTurn.id
                    ? { ...turn, content: turn.content + chunk }
                    : turn,
                ),
              ),
          },
        );
      } else {
        reply = await generateCompanionReply(
          {
            input,
            history,
            conversationId,
            messages: assistantMessages,
            useConversationContext: companionUsesChatContext,
            language: assistantSettings.language,
            tone: assistantSettings.tone,
            draftVoice: draftVoiceForUser(currentUserId()),
            memories: assistantSettings.personalMemory ? personalMemory : [],
          },
          localInferenceProvider,
          {
            signal: controller.signal,
            onProgress: setCompanionProgress,
            onReset: () =>
              setCompanionTurns((turns) =>
                turns.map((turn) =>
                  turn.id === assistantTurn.id
                    ? { ...turn, content: "" }
                    : turn,
                ),
              ),
            onChunk: (chunk) =>
              setCompanionTurns((turns) =>
                turns.map((turn) =>
                  turn.id === assistantTurn.id
                    ? { ...turn, content: turn.content + chunk }
                    : turn,
                ),
              ),
          },
        );
      }
      if (!controller.signal.aborted) {
        setCompanionTurns((turns) =>
          turns.map((turn) =>
            turn.id === assistantTurn.id
              ? { ...turn, content: reply }
              : turn,
          ),
        );
        companionRuntime.dispatch({
          type: "inference-completed",
          outcome: "success",
        });
        if (
          assistantSettings.companionMode === "active-voice" &&
          !assistantSettings.voiceMuted &&
          isSafeSpeechText(
            [
              input,
              ...companionTurns.slice(-4).map((turn) => turn.content),
              ...(companionUsesChatContext
                ? assistantMessages.slice(-6).map((message) => message.plaintext)
                : []),
              reply,
            ].join("\n"),
          )
        ) {
          await speakSuggestion(
            reply,
            `companion-active:${conversationId}:${assistantTurn.id}`,
            true,
          );
        } else if (
          assistantSettings.companionMode === "active-voice" &&
          !assistantSettings.voiceMuted
        ) {
          setSpeechNotice(
            "Automatic speech was skipped because the dialogue may contain sensitive content.",
          );
        } else if (speakCompanionReplies) {
          await speakSuggestion(
            reply,
            `companion:${conversationId}:${assistantTurn.id}`,
            false,
          );
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        companionRuntime.dispatch({
          type: "inference-completed",
          outcome: "error",
        });
        setCompanionTurns((turns) =>
          turns.map((turn) =>
            turn.id === assistantTurn.id
              ? { ...turn, content: "I couldn't respond just now." }
              : turn,
          ),
        );
        setCompanionError(
          error instanceof Error
            ? error.message
            : "The on-device companion could not respond.",
        );
      }
    } finally {
      if (companionController.current === controller) {
        companionController.current = null;
        setResearching(false);
        setCompanionBusy(false);
        setCompanionProgress(null);
        if (controller.signal.aborted) {
          companionRuntime.dispatch({
            type: "inference-completed",
            outcome: "cancelled",
          });
        }
      }
    }
  }

  function submitCompanionMessage(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void sendCompanionMessage(companionInput);
  }

  async function createLocalSummary() {
    if (!local.data?.length || summarizing) {
      return;
    }

    const controller = new AbortController();
    summaryController.current = controller;
    setSummary(null);
    setSummaryError(null);
    setSummaryProgress(null);
    setSummaryRun({ conversationId, controller });

    try {
      const result = await summarizeConversation(
        {
          conversationId,
          messages: assistantMessages,
          language: summaryLanguage,
          tone: summaryTone,
        },
        localInferenceProvider,
        {
          signal: controller.signal,
          onProgress: setSummaryProgress,
        },
      );
      if (!controller.signal.aborted) {
        setSummary({ conversationId, text: result });
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setSummaryError(
          {
            conversationId,
            message: error instanceof Error
              ? error.message
              : "The on-device summary could not be created.",
          },
        );
      }
    } finally {
      if (summaryController.current === controller) {
        summaryController.current = null;
        setSummaryRun(null);
        setSummaryProgress(null);
      }
    }
  }

  const toggleReply = useCallback((messageId: string) => {
    setSelectedReplyIds((ids) =>
      ids.includes(messageId)
        ? ids.filter((id) => id !== messageId)
        : ids.length >= 8
          ? ids
          : [...ids, messageId],
    );
  }, []);
  const askDelete = useCallback((messageId: string) => {
    setDeleteMessageError(null);
    setConfirmDeleteId(messageId);
  }, []);
  const deleteMutate = deleteMessage.mutate;
  const confirmDelete = useCallback((message: LocalMessage) => {
    deleteMutate(message);
  }, [deleteMutate]);
  const cancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  function stageInboxAction(action: AgentToolAction) {
    const runtime = agentRuntimeRef.current;
    if (!runtime) {
      const message = "Sophia actions are not ready yet.";
      setAgentActionError(message);
      throw new Error(message);
    }
    runtime.propose(action, { provenance: "command" });
    setAgentActionError(null);
    setActivitySheet(null);
    setCompanionOpen(false);
  }

  if (!conversation) {
    return <div className="flex h-full items-center justify-center text-white/40">{t("chat.select")}</div>;
  }

  return (
    <div className="thread-stage relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <header className="thread-header relative z-30 flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 bg-[#070b12] px-3 py-2.5 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label={t("chat.back")}
            title={t("chat.back")}
            onClick={() => router.push("/inbox")}
          >
            <ArrowLeft aria-hidden="true" className="size-4 rtl-flip" />
          </Button>
          {conversation.peer && conversation.lastMessageAt ? (
            <ChatPresence
              person={conversation.peer}
              contactId={conversation.peer.id}
              conversationId={conversation.id}
              isNew={false}
              size={40}
            />
          ) : conversation.peer ? (
            <PersonAvatar person={conversation.peer} size={40} />
          ) : null}
          <div className="min-w-0">
          <p className="truncate text-sm font-medium"><BidiText>{conversation.peer?.displayName}</BidiText></p>
            <p className="truncate text-xs text-white/40">
              {t("chat.encrypted")}
              {" · "}
              <LtrIsolate>@{conversation.peer?.username}</LtrIsolate>
            </p>
          </div>
        </div>
        <div className="thread-header-actions ms-auto min-w-0 items-center justify-end sm:flex-nowrap">
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("chat.voice", { username: conversation.peer?.username ?? "user" })}
          title={t("chat.voiceTitle")}
          disabled={!conversation.peer || Boolean(calls.call)}
          onClick={() => {
            if (conversation.peer) {
              void calls.startCall(conversationId, conversation.peer, "audio");
            }
          }}
        >
          <Phone aria-hidden="true" className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("chat.video", { username: conversation.peer?.username ?? "user" })}
          title={t("chat.videoTitle")}
          disabled={!conversation.peer || Boolean(calls.call)}
          onClick={() => {
            if (conversation.peer) {
              void calls.startCall(conversationId, conversation.peer, "video");
            }
          }}
        >
          <Video aria-hidden="true" className="size-4" />
        </Button>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-xs text-white/75 transition-colors hover:bg-white/5"
          title={t("chat.openSettings")}
          aria-label={t("chat.openSettings")}
        >
          <Settings aria-hidden="true" className="size-3.5" />
          {t("chat.settings")}
        </Link>
        <Button
          type="button"
          size="sm"
          variant={replySelectMode ? "default" : "outline"}
          className="gap-1.5"
          title={replySelectMode ? t("chat.cancelReply") : t("chat.reply")}
          aria-label={replySelectMode ? t("chat.cancelReply") : t("chat.reply")}
          aria-pressed={replySelectMode}
          onClick={() => {
            setReplySelectMode((open) => !open);
            if (replySelectMode) setSelectedReplyIds([]);
          }}
        >
          <CheckSquare aria-hidden="true" className="size-3.5" />
          {replySelectMode ? t("chat.cancelReply") : t("chat.reply")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activitySheet === "email" ? "default" : "outline"}
          className="gap-1.5"
          title={t("chat.compose")}
          aria-label={t("chat.compose")}
          aria-pressed={activitySheet === "email"}
          onClick={() =>
            setActivitySheet((current) => (current === "email" ? null : "email"))
          }
        >
          <Mail aria-hidden="true" className="size-3.5" />
          {t("chat.compose")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activitySheet === "event" ? "default" : "outline"}
          className="gap-1.5"
          title={t("chat.calendar")}
          aria-label={t("chat.calendar")}
          aria-pressed={activitySheet === "event"}
          onClick={() =>
            setActivitySheet((current) => (current === "event" ? null : "event"))
          }
        >
          <Calendar aria-hidden="true" className="size-3.5" />
          {t("chat.calendar")}
        </Button>
        <Button asChild size="sm" variant="outline" className="gap-2">
          <Link
            href="/inbox?hub=assistant"
            title="Open the Sophia assistant. This stays separate from this chat."
            aria-label="Open the Sophia assistant. This stays separate from this chat."
          >
            {t("inbox.hub.assistant")}
          </Link>
        </Button>
        </div>
      </header>
      <AnimatePresence>
      {companionOpen ? (
        <motion.aside
          key="private-companion-panel"
          aria-label="Sophia private AI companion"
          initial={
            reduceMotion
              ? { opacity: 1 }
              : { opacity: 0, y: 22, scale: 0.97 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 14, scale: 0.98 }
          }
          transition={{
            duration: reduceMotion ? 0 : 0.28,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] top-[max(5.5rem,env(safe-area-inset-top))] z-40 flex min-h-0 flex-col overflow-hidden border border-white/10 bg-[#0b0f16] shadow-2xl shadow-black/40 sm:absolute sm:inset-x-auto sm:right-3 sm:bottom-3 sm:top-16 sm:w-[min(92vw,32rem)] sm:rounded-3xl md:right-4 md:w-[min(52vw,30rem)] lg:right-5 lg:w-[min(42vw,28rem)]"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <SophiaRobot
                presence={companionPresence}
                speaking={companionPresence === "speaking"}
                listening={listeningForCompanion || companionPresence === "listening"}
                thinking={aiIsThinking}
                size="sm"
                className="!gap-0"
              />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Sophia</h2>
                <p className="truncate text-[10px] text-white/40">
                  Talking robot · on this device
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="mr-2 hidden text-[10px] capitalize text-white/40 sm:inline">
                {listeningForCompanion ? "Listening" : aiWorkLabel}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={companionTurns.length === 0}
                onClick={() => {
                  stopCompanion();
                  setCompanionTurns([]);
                  setCompanionError(null);
                  setCompanionObservation(null);
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Close Sophia"
                onClick={() => {
                  stopCompanion(false);
                  setCompanionOpen(false);
                }}
              >
                ×
              </Button>
            </div>
          </div>
          <p className="shrink-0 border-b border-white/[0.06] px-4 py-2 text-[10px] text-white/40">
            Separate from the contact chat · on this device
          </p>
          {!assistantSettings?.enabled ? (
            <div className="m-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/65">
              The Sophia assistant is a separate inbox section. It does not read this chat unless you allow it there.
            </div>
          ) : (
            <>
              <div
                aria-live="polite"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              >
                {assistantSettings?.radarAnalysisEnabled ? (
                  <section className="space-y-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-100/70">
                          Daily briefing · on-device
                        </p>
                        <p className="mt-1 text-[11px] text-white/50">
                          Built from authorized local findings and accepted task drafts. Ask “what’s outstanding?” or “what did I promise X?” in chat. Click a due task to stage a follow-up — never silent writes.
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => refreshRadarBriefing()}
                        >
                          Refresh
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => proposeDeadlineActions()}
                        >
                          Stage deadlines
                        </Button>
                      </div>
                    </div>
                    {radarBriefing ? (
                      <div className="space-y-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/75">
                        <p className="font-medium text-white/85">
                          {radarBriefing.headline}
                        </p>
                        {radarBriefing.lines.map((line, index) => (
                          <p key={`${index}-${line.slice(0, 24)}`} className="whitespace-pre-wrap">
                            {line}
                          </p>
                        ))}
                        {radarStore.taskDrafts
                          .filter(
                            (draft) =>
                              draft.status === "open" &&
                              (!conversationRadarAllowed ||
                                !draft.conversationId ||
                                draft.conversationId === conversationId),
                          )
                          .slice(0, 4)
                          .map((draft) => (
                            <button
                              key={`briefing-task-${draft.id}`}
                              type="button"
                              className="mt-1 block w-full rounded-lg border border-emerald-300/15 bg-emerald-300/[0.05] px-2 py-1.5 text-left text-[11px] text-emerald-50/90 transition hover:bg-emerald-300/10"
                              onClick={() => proposeBriefingTaskAction(draft)}
                            >
                              Stage action · {draft.title}
                              {draft.dueAt ? ` · due ${draft.dueAt.slice(0, 10)}` : ""}
                            </button>
                          ))}
                      </div>
                    ) : (
                      <p className="text-xs text-white/45">
                        Generate a local briefing anytime. Nothing leaves this device.
                      </p>
                    )}
                    <p className="text-[10px] text-white/40">
                      Local counters · proposed {radarCounters.findingsProposed} ·
                      accepted {radarCounters.findingsAccepted} · dismissed{" "}
                      {radarCounters.findingsDismissed} · briefings{" "}
                      {radarCounters.briefingsGenerated} · Q&amp;A{" "}
                      {radarCounters.questionsAnswered}
                    </p>
                  </section>
                ) : null}
                {assistantSettings?.radarAnalysisEnabled &&
                conversationRadarAllowed ? (
                  <section className="space-y-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-100/70">
                        Commitment Radar · pending
                      </p>
                      <p className="mt-1 text-[11px] text-white/50">
                        Local heuristic scan of decrypted messages in this allowed thread. Approve to save a device-local task draft.
                      </p>
                    </div>
                    {pendingRadarFindings.length === 0 ? (
                      <p className="text-xs text-white/45">
                        No pending findings yet.
                      </p>
                    ) : (
                      pendingRadarFindings.slice(0, 8).map((finding) => {
                        const edit = radarFindingEdits[finding.id] ?? {
                          title: finding.title,
                          dueAt: finding.dueAt ?? "",
                        };
                        return (
                          <article
                            key={finding.id}
                            className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3"
                          >
                            <p className="text-[10px] uppercase tracking-wide text-white/40">
                              {finding.category} · {finding.committedBy}
                            </p>
                            <label className="block space-y-1 text-[10px] text-white/50">
                              Title
                              <input
                                className="h-9 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                                value={edit.title}
                                onChange={(event) =>
                                  setRadarFindingEdits((current) => ({
                                    ...current,
                                    [finding.id]: {
                                      ...edit,
                                      title: event.target.value.slice(0, 160),
                                    },
                                  }))
                                }
                              />
                            </label>
                            <label className="block space-y-1 text-[10px] text-white/50">
                              Due (optional)
                              <input
                                className="h-9 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                                value={edit.dueAt}
                                placeholder="YYYY-MM-DD"
                                onChange={(event) =>
                                  setRadarFindingEdits((current) => ({
                                    ...current,
                                    [finding.id]: {
                                      ...edit,
                                      dueAt: event.target.value.slice(0, 40),
                                    },
                                  }))
                                }
                              />
                            </label>
                            <p className="line-clamp-3 text-[11px] text-white/55">
                              {finding.excerpt}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  proposeRadarFindingAction(finding, "accept")
                                }
                              >
                                Approve
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  proposeRadarFindingAction(finding, "snooze")
                                }
                              >
                                Snooze 1d
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  proposeRadarFindingAction(finding, "dismiss")
                                }
                              >
                                Dismiss
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  proposeRadarFindingAction(finding, "secondary")
                                }
                              >
                                Also stage writes
                              </Button>
                            </div>
                          </article>
                        );
                      })
                    )}
                    {radarStore.taskDrafts.filter(
                      (draft) =>
                        draft.status === "open" &&
                        draft.conversationId === conversationId,
                    ).length > 0 ? (
                      <div className="border-t border-white/10 pt-2">
                        <p className="text-[10px] uppercase tracking-wide text-white/40">
                          Local task drafts
                        </p>
                        <ul className="mt-1 space-y-1 text-xs text-white/65">
                          {radarStore.taskDrafts
                            .filter(
                              (draft) =>
                                draft.status === "open" &&
                                draft.conversationId === conversationId,
                            )
                            .slice(0, 5)
                            .map((draft) => (
                              <li key={draft.id}>
                                {draft.title}
                                {draft.dueAt ? ` · due ${draft.dueAt}` : ""}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {companionTurns.length === 0 ? (
                  <div className="space-y-2 rounded-2xl bg-white/[0.035] p-4 text-sm text-white/60">
                    <p className="font-medium text-white/80">
                      What should we take care of?
                    </p>
                    <p>
                      Use mention chips or slash hints below, or say “@Sophia …” / “Sophia, …” for compound job ops. Pattern matches stage immediately; free-form uses the local model. Nothing external runs until you approve the exact payload.
                    </p>
                  </div>
                ) : null}
                <SophiaApproveSuccess message={approveFlash} />
                {companionTurns.map((turn) => (
                  <article
                    key={turn.id}
                    className={`rounded-2xl p-3 text-sm ${
                      turn.role === "user"
                        ? "ml-6 bg-white/[0.08] text-white/85"
                        : "mr-4 border border-white/[0.07] bg-black/30 text-white/80"
                    }`}
                  >
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                      {turn.role === "user" ? "You" : "Sophia · on-device"}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {turn.content ||
                        (companionBusy && turn.role === "assistant"
                          ? "Thinking…"
                          : "Response stopped.")}
                    </p>
                    {turn.sources?.length ? (
                      <div className="mt-3 border-t border-white/10 pt-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                          Web sources
                        </p>
                        <ol className="list-inside list-decimal space-y-1">
                          {turn.sources.map((source, index) => (
                            <li key={source.url} className="text-xs text-white/60">
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline underline-offset-2 hover:text-white"
                              >
                                [{index + 1}] {source.title}
                              </a>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    {turn.role === "assistant" && turn.content ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-xs text-white/50 hover:text-white"
                          onClick={() => {
                            form.setValue("body", turn.content, {
                              shouldDirty: true,
                              shouldTouch: true,
                            });
                            companionRuntime.dispatch({
                              type: "activity-updated",
                              state: "drafting",
                            });
                          }}
                        >
                          Insert as draft
                        </button>
                        <button
                          type="button"
                          className="text-xs text-white/50 hover:text-white"
                          disabled={assistantSettings.voiceMuted}
                          onClick={() =>
                            void speakSuggestion(
                              turn.content,
                              `companion-manual:${conversationId}:${turn.id}:${++selectedSpeechSequence.current}`,
                              false,
                            )
                          }
                        >
                          Speak
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
                {companionProgress?.phase === "loading" ? (
                  <p role="status" className="text-xs text-(--accent)">
                    Loading local model
                    {typeof companionProgress.percent === "number"
                      ? ` (${Math.round(companionProgress.percent)}%)`
                      : "…"}
                  </p>
                ) : null}
                {researching ? (
                  <p role="status" className="text-xs text-(--accent)">
                    Searching the web…
                  </p>
                ) : null}
                {companionProgress?.phase === "generating" && companionBusy ? (
                  <p role="status" className="text-xs text-(--accent)">
                    Thinking on this device…
                  </p>
                ) : null}
                {companionError ? (
                  <div role="alert" className="space-y-2 rounded-xl bg-red-950/40 p-3 text-xs text-red-200">
                    <p>{companionError}</p>
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      disabled={companionBusy}
                      onClick={() => {
                        const lastUserTurn = [...companionTurns]
                          .reverse()
                          .find((turn) => turn.role === "user");
                        if (lastUserTurn && !companionBusy) {
                          void sendCompanionMessage(lastUserTurn.content, true);
                        }
                      }}
                    >
                      Retry response
                    </button>
                  </div>
                ) : null}
                {speechNotice ? (
                  <p role="status" className="text-xs text-white/45">
                    {speechNotice}
                  </p>
                ) : null}
                <details className="rounded-xl border border-white/10 bg-white/[0.025]">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-white/70">
                    Job write defaults · device-local
                  </summary>
                  <div className="space-y-2 border-t border-white/10 p-3 text-[11px] text-white/55">
                    <p>
                      Prefills GitHub/Linear/Slack/calendar proposals. Connect ≠ AI consent; external writes still need approve.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        Calendar
                        <select
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.calendarProvider ?? "google"}
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              calendarProvider: event.target.value as
                                | "google"
                                | "outlook",
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        >
                          <option value="google">Google</option>
                          <option value="outlook">Outlook</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        Email
                        <select
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.emailProvider ?? "gmail"}
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              emailProvider: event.target.value as
                                | "gmail"
                                | "outlook-mail",
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        >
                          <option value="gmail">Gmail</option>
                          <option value="outlook-mail">Outlook Mail</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        GitHub owner
                        <input
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.githubOwner ?? ""}
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              githubOwner: event.target.value.slice(0, 80),
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        />
                      </label>
                      <label className="space-y-1">
                        GitHub repo
                        <input
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.githubRepo ?? ""}
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              githubRepo: event.target.value.slice(0, 80),
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        />
                      </label>
                      <label className="col-span-2 space-y-1">
                        Linear team id
                        <input
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.linearTeamId ?? ""}
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              linearTeamId: event.target.value.slice(0, 64),
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        />
                      </label>
                      <label className="space-y-1">
                        Slack channel id
                        <input
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.slackChannelId ?? ""}
                          placeholder="C…"
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              slackChannelId: event.target.value.slice(0, 32),
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        />
                      </label>
                      <label className="space-y-1">
                        Slack channel name
                        <input
                          className="h-8 w-full rounded-lg border border-white/10 bg-[#151515] px-2 text-xs text-white"
                          value={jobDefaults.slackChannelName ?? ""}
                          onChange={(event) => {
                            const next = {
                              ...jobDefaults,
                              slackChannelName: event.target.value.slice(0, 80),
                            };
                            setJobDefaults(next);
                            saveJobDefaults(activeUserId, next);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </details>
                <AnimatePresence initial={false}>
                  {agentProposals
                    .filter(
                      (proposal) =>
                        proposal.action.type === "create_document" ||
                        proposal.action.type === "remember_fact" ||
                        proposal.action.type === "forget_fact" ||
                        proposal.action.type === "draft_message" ||
                        proposal.action.type === "web_search" ||
                        proposal.action.type === "accept_finding" ||
                        proposal.action.type === "dismiss_finding" ||
                        proposal.action.type === "snooze_reminder",
                    )
                    .map((proposal) => (
                      <SophiaProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        onApprove={approveAgentProposal}
                        onCancel={cancelAgentProposal}
                      />
                    ))}
                </AnimatePresence>
              </div>
              <div className="shrink-0 border-t border-white/10 bg-[#0b0c0e]/95 p-3 sm:p-4">
                <form className="space-y-2" onSubmit={(event) => void submitCompanionMessage(event)}>
                  <SophiaCommandHints
                    input={companionInput}
                    disabled={companionBusy}
                    onInsert={insertCompanionHint}
                  />
                  <textarea
                    aria-label="Message Sophia"
                    className="min-h-24 max-h-40 w-full resize-y rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 text-sm leading-relaxed text-white outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-white/30 focus:border-(--accent)/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(216,178,110,0.08)]"
                    maxLength={2_000}
                    placeholder="@Sophia … or /schedule · nothing sends until you approve"
                    value={companionInput}
                    onChange={(event) => setCompanionInput(event.target.value)}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <div className="flex shrink-0 items-center gap-2">
                      {listeningForCompanion ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => speechInputProvider.current.cancel()}
                        >
                          Stop listening
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={
                            !microphoneEnabled ||
                            (!selectedSpeechInputAvailable &&
                              !allowBrowserSpeech) ||
                            companionBusy
                          }
                          title={
                            !microphoneEnabled
                              ? "Enable the microphone control before starting local speech recognition"
                              : selectedSpeechInputAvailable
                                ? "Use on-device speech recognition"
                                : allowBrowserSpeech
                                  ? "Use the browser speech provider; audio may leave the device"
                                  : "No installed local speech pack; optionally allow the browser speech service"
                          }
                          onClick={() => void startCompanionListening()}
                        >
                          {!microphoneEnabled
                            ? "Mic off"
                            : selectedSpeechInputAvailable
                              ? "Speak"
                              : allowBrowserSpeech
                                ? "Speak via browser"
                                : "Mic unavailable"}
                        </Button>
                      )}
                      {companionBusy ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => stopCompanion()}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="sm"
                          disabled={!companionInput.trim()}
                        >
                          Talk
                        </Button>
                      )}
                    </div>
                  </div>
                </form>
                {listeningForCompanion ? (
                  <p role="status" className="mt-2 text-xs text-(--accent)">
                    {allowBrowserSpeech && !selectedSpeechInputAvailable
                      ? "Listening with the browser speech provider. Audio may leave this device."
                      : "Listening on this device… speech is not sent to an online service."}
                  </p>
                ) : null}
              </div>
              <p className="border-t border-white/10 px-4 py-2 text-[10px] leading-relaxed text-white/35">
                Dialogue stays in this page’s memory and is cleared when you leave this chat or press Clear. Optional personal notes stay in this browser only when you approve them. Local model files may be downloaded; prompts and chat text are not uploaded.
              </p>
            </>
          )}
        </motion.aside>
      ) : null}
      </AnimatePresence>
      {assistantSettings?.enabled ? (
        <div className="pointer-events-none absolute bottom-[7.5rem] left-3 z-20 sm:bottom-28 sm:left-6">
          <Link
            href="/inbox?hub=assistant"
            className="pointer-events-auto rounded-[1.75rem] border border-white/10 bg-[#0b1018] p-2 shadow-2xl transition-colors hover:border-cyan-300/30"
            title="Open the Sophia assistant. This stays separate from this chat."
            aria-label="Open the Sophia assistant. This stays separate from this chat."
          >
            <SophiaRobot
              presence={companionPresence}
              speaking={companionPresence === "speaking"}
              listening={listeningForCompanion || companionPresence === "listening"}
              thinking={aiIsThinking}
              size="md"
            />
          </Link>
        </div>
      ) : null}
      <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={chatScrollRef}
        onScroll={(event) => {
          if (activitySheet) return;
          if (event.currentTarget.scrollTop < 64) {
            void loadOlderMessages();
          }
        }}
        className="thread-scroll absolute inset-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-6 sm:py-6"
      >
        {loadingOlderMessages ? (
          <p role="status" className="py-2 text-center text-xs text-white/45">
            Loading earlier messages…
          </p>
        ) : historyLoadError ? (
          <div className="flex items-center justify-center gap-2 py-2 text-xs">
            <p role="alert" className="text-red-300">{historyLoadError}</p>
            <button
              type="button"
              className="text-white/70 underline underline-offset-2"
              onClick={() => void loadOlderMessages()}
            >
              Retry
            </button>
          </div>
        ) : !hasOlderMessages && visibleMessages.length > 0 ? (
          <p className="py-2 text-center text-xs text-white/30">
            Beginning of conversation
          </p>
        ) : null}
        {conversation.peer && !conversation.lastMessageAt ? (
          <div className="flex justify-center py-8">
            <ChatPresence
              person={conversation.peer}
              contactId={conversation.peer.id}
              conversationId={conversation.id}
              isNew
              size={148}
            />
          </div>
        ) : null}
        {activitySheet ? null : (
          <ThreadMessageList
            messages={visibleMessages}
            conversationId={conversationId}
            peer={conversation.peer}
            replySelectMode={replySelectMode}
            selectedReplyIds={selectedReplyIds}
            confirmDeleteId={confirmDeleteId}
            deleteMessageError={deleteMessageError}
            deletePending={deleteMessage.isPending}
            onToggleReply={toggleReply}
            onAskDelete={askDelete}
            onConfirmDelete={confirmDelete}
            onCancelDelete={cancelDelete}
          />
        )}
      </div>
      {activitySheet === "email" ? (
        <InboxComposeLetter
          open
          onClose={() => setActivitySheet(null)}
          onStage={stageInboxAction}
          emailProvider={jobDefaults.emailProvider ?? "gmail"}
        />
      ) : activitySheet ? (
        <div className="inbox-sheet-scrim absolute inset-0 z-10 grid place-items-center p-3 sm:p-6">
          <div className="flex h-[min(88dvh,42rem)] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070b12] shadow-2xl">
            <InboxActivityPanel
              view={activitySheet}
              onViewChange={setActivitySheet}
              onClose={() => setActivitySheet(null)}
              onStage={stageInboxAction}
              emailProvider={jobDefaults.emailProvider ?? "gmail"}
              calendarProvider={jobDefaults.calendarProvider ?? "google"}
            />
          </div>
        </div>
      ) : null}
      </div>
      {assistantSettings?.enabled && companionObservation ? (
        <aside
          role="status"
          aria-live="polite"
          className="mx-4 mb-3 flex items-start gap-3 rounded-2xl border border-(--accent)/25 bg-(--accent)/[0.07] p-3"
        >
          <span
            aria-hidden="true"
            className="mt-1 inline-block size-2.5 shrink-0 rounded-full bg-(--accent)"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-(--accent)">
              Companion observation
            </p>
            <p className="mt-1 text-xs leading-relaxed text-white/75">
              {companionObservation.text}
            </p>
            <button
              type="button"
              className="mt-2 text-xs text-white/55 underline underline-offset-2 hover:text-white"
              onClick={() => setCompanionOpen(true)}
            >
              Talk it through
            </button>
          </div>
          {selectedPhoto ? (
            <button
              type="button"
              disabled={sendMedia.isPending}
              className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-40"
              onClick={() => setPhotoEditorOpen(true)}
            >
              Edit
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss companion observation"
            className="px-1 text-white/40 hover:text-white"
            onClick={() => setCompanionObservation(null)}
          >
            ×
          </button>
        </aside>
      ) : null}
      {assistantSettings?.enabled && latestIncomingId ? (
        <section
          aria-label="Suggested replies"
          className="shrink-0 space-y-2 border-t border-white/10 px-4 py-3"
        >
          {suggestionView?.key === currentSuggestionKey &&
          suggestionView.messageId === latestIncomingId &&
          dismissedSuggestionsFor !== latestIncomingId ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-white/55">
                  Suggested replies · review before sending
                </p>
                {suggestionView.status === "ready" ? (
                  <button
                    type="button"
                    className="text-xs text-white/40 hover:text-white"
                    onClick={() => setDismissedSuggestionsFor(latestIncomingId)}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
              {suggestionView.status === "loading" ? (
                <p role="status" className="text-xs text-(--accent)">
                  {suggestionView.progress?.phase === "loading"
                    ? `Preparing local assistant${typeof suggestionView.progress.percent === "number"
                      ? ` (${Math.round(suggestionView.progress.percent)}%)`
                      : "…"}`
                    : "Thinking of reply ideas on this device…"}
                </p>
              ) : null}
              {suggestionView.status === "error" ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p role="alert" className="text-xs text-red-300">
                    {suggestionView.error}
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={retrySuggestions}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {suggestionView.status === "ready" ? (
                <div className="flex flex-wrap gap-2">
                  {suggestionView.suggestions.map((suggestion, index) => (
                    <div
                      key={suggestion}
                      className="flex max-w-full items-center rounded-full border border-white/10 bg-white/[0.035]"
                    >
                      <button
                        type="button"
                        className="max-w-[min(70vw,32rem)] px-4 py-2 text-left text-sm text-white/80 hover:text-white"
                        title="Insert into the message composer; it will not send automatically"
                        onClick={() =>
                          form.setValue("body", suggestion, {
                            shouldDirty: true,
                            shouldTouch: true,
                          })
                        }
                      >
                        {suggestion}
                      </button>
                      <button
                        type="button"
                        aria-label={`Dismiss suggestion: ${suggestion}`}
                        className="px-3 py-2 text-white/40 hover:text-white"
                        onClick={() =>
                          setSuggestionView((current) =>
                            current?.key === suggestionView.key
                              ? {
                                  ...current,
                                  suggestions: current.suggestions.filter(
                                    (item) => item !== suggestion,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        ×
                      </button>
                      {assistantSettings?.voiceMode !== "silent" ? (
                        <button
                          type="button"
                          className="border-l border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white disabled:opacity-40"
                          disabled={assistantSettings.voiceMuted}
                          aria-label={`Speak suggestion ${index + 1}`}
                          onClick={() =>
                            void speakSuggestion(
                              suggestion,
                              `selected:${conversationId}:${latestIncomingId}:${index}:${++selectedSpeechSequence.current}`,
                              false,
                            )
                          }
                        >
                          Listen
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {speechNotice ? (
                <p role="status" className="text-xs text-white/45">
                  {speechNotice}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-white/35">
              Reply suggestions appear here after a new incoming message.
            </p>
          )}
        </section>
      ) : null}
      {agentProposals
        .filter(
          (proposal) =>
            proposal.action.type === "send_message" ||
            proposal.action.type === "draft_message",
        )
        .map((proposal) => {
          if (proposal.action.type === "draft_message") {
            return (
              <section
                key={proposal.id}
                aria-label={t("chat.reviewDraft")}
                className="mx-4 mb-2 space-y-2 rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-3"
              >
                <p className="text-xs font-semibold text-amber-100/80">
                  {t("chat.fillDraft")}
                </p>
                <p className="text-xs text-white/60">
                  To: @{proposal.action.recipientUsername}
                </p>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-sm text-white/90">
                  {proposal.action.body}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void approveAgentProposal(proposal)}
                  >
                    {t("chat.insertDraft")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => cancelAgentProposal(proposal)}
                  >
                    {t("chat.cancel")}
                  </Button>
                </div>
              </section>
            );
          }
          if (proposal.action.type !== "send_message") {
            return null;
          }
          const unchanged = composerBody === proposal.action.body;
          return (
            <section
              key={proposal.id}
              aria-label={t("chat.reviewSend")}
              className="mx-4 mb-2 space-y-2 rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-3"
            >
              <p className="text-xs font-semibold text-amber-100/80">
                {t("chat.confirmSend")}
              </p>
              <p className="text-xs text-white/60">
                To: @{proposal.action.recipientUsername}
              </p>
              <p className="whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-sm text-white/90">
                {proposal.action.body}
              </p>
              {!unchanged ? (
                <p role="status" className="text-xs text-amber-100/75">
                  The composer changed. This approval no longer applies; cancel it and review the updated message.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!unchanged || send.isPending}
                  onClick={() => void approveAgentProposal(proposal)}
                >
                  {send.isPending ? "Sending…" : "Confirm and send"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => cancelAgentProposal(proposal)}
                >
                  Cancel
                </Button>
              </div>
            </section>
          );
        })}
      {!companionOpen ? <div className="mx-3 mb-2 sm:mx-4"><SophiaApproveSuccess message={approveFlash} /></div> : null}
      {agentProposals.some((proposal) => isJobManagerTool(proposal.action.type)) ? (
        <div className="mx-3 mb-2 max-h-64 space-y-2 overflow-y-auto sm:mx-4">
          {agentProposals
            .filter((proposal) => isJobManagerTool(proposal.action.type))
            .map((proposal) => (
              <SophiaProposalCard
                key={proposal.id}
                proposal={proposal}
                onApprove={approveAgentProposal}
                onCancel={cancelAgentProposal}
              />
            ))}
        </div>
      ) : null}
      {agentActionError ? (
        <p role="alert" className="mx-4 mb-2 text-xs text-red-300">
          {agentActionError}
        </p>
      ) : null}
      <div className="relative shrink-0 border-t border-white/10 bg-[#070b12] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        {replySelectMode || selectedReplyIds.length ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs text-cyan-50/85">
            <p>
              {selectedReplyIds.length
                ? `${selectedReplyIds.length} message${selectedReplyIds.length === 1 ? "" : "s"} selected for reply`
                : "Tap messages below to include them in one reply"}
            </p>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                setSelectedReplyIds([]);
                setReplySelectMode(false);
              }}
            >
              Clear
            </button>
          </div>
        ) : null}
        {selectedPhotos.length || selectedVideo || selectedVoiceNote || selectedFile || selectedLocation ? (
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-2">
            {selectedPhotos.length ? (
              <div className="flex max-w-[min(70vw,18rem)] gap-1 overflow-x-auto">
                {selectedPhotos.map((file, index) => (
                  <span key={`${file.name}-${file.size}-${index}`} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      ref={(element) => {
                        selectedPhotoPreviewRefs.current[index] = element;
                      }}
                      alt=""
                      className="size-14 rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      className="absolute -end-1 -top-1 rounded-full bg-black/80 px-1.5 text-[10px] text-white"
                      title={`Remove ${file.name}`}
                      aria-label={`Remove photo ${file.name}`}
                      disabled={sendMedia.isPending || recordingVoiceNote || locating}
                      onClick={() => {
                        setSelectedPhotos((current) => current.filter((_, item) => item !== index));
                        setPhotoEditorOpen(false);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                ))}
              </div>
            ) : selectedVideo ? (
              <video
                ref={selectedVideoPreviewRef}
                muted
                playsInline
                controls
                preload="metadata"
                aria-label="Selected video preview"
                className="size-14 shrink-0 rounded-lg bg-black object-cover"
              />
            ) : selectedVoiceNote ? (
              <audio
                ref={selectedAudioPreviewRef}
                controls
                preload="metadata"
                aria-label="Voice note preview"
                className="h-10 min-w-0 max-w-[min(14rem,45vw)]"
              />
            ) : selectedFile ? (
              <Paperclip aria-hidden="true" className="mx-4 size-6 shrink-0 text-white/65" />
            ) : selectedLocation ? (
              <MapPin aria-hidden="true" className="mx-4 size-6 shrink-0 text-cyan-200/80" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-white/75" title={selectedFile?.encrypted.name}>
                {selectedLocation
                  ? `${formatCoordinate(selectedLocation.lat)}, ${formatCoordinate(selectedLocation.lon)}`
                  : selectedVoiceNote
                  ? `Voice note · ${Math.floor(selectedVoiceNote.duration)}s`
                  : selectedFile
                    ? selectedFile.encrypted.name
                    : selectedPhotos.length > 1
                      ? `${selectedPhotos.length} photos selected`
                      : (selectedPhoto ?? selectedVideo)?.name}
              </p>
              <p className="mt-1 text-[10px] text-white/40">
                {selectedLocation
                  ? [
                      "Encrypted in the message body · not uploaded as a map file",
                      describeLocationAccuracy(selectedLocation.accuracy),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : selectedVoiceNote
                  ? "Caption generated on this device · encrypted before upload"
                  : selectedFile
                    ? `${(selectedFile.file.size / (1024 * 1024)).toFixed(1)} MB · checked and encrypted on this device`
                    : selectedVideo
                      ? `Compressed to 480p · max ${maxVideoDurationSeconds} seconds · encrypted before upload`
                      : selectedPhotos.length > 1
                        ? `One encrypted album message · up to ${maxAlbumPhotos} photos · 6 MB each`
                        : "Encrypted on this device before upload · max 6 MB"}
              </p>
              {selectedFile?.encrypted.containsExternalLinks ? (
                <p role="alert" className="mt-1 text-[10px] text-amber-200">
                  Contains external links. Review carefully before opening or sending.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              title="Remove the attachment before sending"
              aria-label="Remove the attachment before sending"
              disabled={sendMedia.isPending || recordingVoiceNote || locating}
              className="inline-flex items-center gap-1 rounded-full px-2 py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => {
                videoSelectionRequest.current += 1;
                fileSelectionRequest.current += 1;
                setSelectedPhotos([]);
                setSelectedVideo(null);
                setSelectedVoiceNote(null);
                setSelectedFile(null);
                setSelectedLocation(null);
                setPreparingFile(false);
                setPhotoEditorOpen(false);
              }}
            >
              <X aria-hidden="true" className="size-4" />
              Remove
            </button>
          </div>
        ) : null}
        {emojiPickerOpen ? (
          <div
            id="message-emoji-picker"
            role="group"
            aria-label="Choose an emoji"
            className="absolute bottom-full left-3 z-40 mb-2 grid max-h-56 w-[min(19rem,calc(100vw-1.5rem))] grid-cols-8 gap-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#151618] p-2 shadow-2xl sm:left-4"
          >
            {[
              "😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😉",
              "😊", "😍", "🥰", "😘", "😎", "🤔", "🥺", "😭",
              "😢", "😴", "🙌", "👏", "🙏", "👍", "👎", "🤝",
              "❤️", "💛", "💚", "💙", "💜", "🔥", "🎉", "✨",
              "💯", "🌹", "☕", "🌙", "✅", "🤍", "💪", "🫶",
            ].map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Insert ${emoji}`}
                title={`Insert ${emoji}`}
                className="grid size-9 place-items-center rounded-lg text-xl transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-(--accent)"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => insertComposerEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
        {attachmentMenuOpen ? (
          <div
            id="message-attachment-menu"
            role="group"
            aria-label="Choose attachment type"
            className="absolute bottom-full left-3 z-40 mb-2 flex w-[min(16rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-white/10 bg-[#151618] p-2 shadow-2xl sm:left-4"
          >
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
              title="Attach one or more photos. You can remove each photo before sending."
              aria-label="Attach one or more photos. You can remove each photo before sending."
              onClick={() => {
                setAttachmentMenuOpen(false);
                photoInputRef.current?.click();
              }}
            >
              Photos (1–{maxAlbumPhotos}, 6 MB each)
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
              title="Attach a video. You can remove it before sending."
              aria-label="Attach a video. You can remove it before sending."
              onClick={() => {
                setAttachmentMenuOpen(false);
                videoInputRef.current?.click();
              }}
            >
              Video (up to 75 seconds)
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
              title="Attach a document. You can remove it before sending."
              aria-label="Attach a document. You can remove it before sending."
              onClick={() => {
                setAttachmentMenuOpen(false);
                fileInputRef.current?.click();
              }}
            >
              Verified document (up to 450 MB)
            </button>
            <button
              type="button"
              title="Share your current location in this chat"
              aria-label="Share your current location in this chat"
              className="rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
              disabled={locating || send.isPending || sendMedia.isPending}
              onClick={() => void shareCurrentLocation()}
            >
              {locating ? "Reading location…" : "Current location"}
            </button>
          </div>
        ) : null}
        <form
          className="composer-bar flex min-w-0 items-center gap-1 sm:gap-2"
          onSubmit={handleMessageSubmit}
        >
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            title="Attach one or more photos. You can remove each photo before sending."
            aria-label="Attach one or more photos. You can remove each photo before sending."
            onChange={handlePhotoSelection}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            title="Attach a video. You can remove it before sending."
            aria-label="Attach a video. You can remove it before sending."
            onChange={(event) => void handleVideoSelection(event)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
            className="hidden"
            title="Attach a document. You can remove it before sending."
            aria-label="Attach a document. You can remove it before sending."
            onChange={(event) => void handleFileSelection(event)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-white/65 sm:size-10"
            disabled={
              send.isPending ||
              sendMedia.isPending ||
              recordingVoiceNote ||
              preparingFile ||
              locating ||
              Boolean(
                selectedPhotos.length ||
                  selectedVideo ||
                  selectedVoiceNote ||
                  selectedFile ||
                  selectedLocation,
              )
            }
            title={attachmentMenuOpen ? "Close attachment options" : "Attach a photo, video, or document"}
            aria-label={attachmentMenuOpen ? "Close attachment options" : "Attach a photo, video, or document. You can remove it before sending."}
            aria-expanded={attachmentMenuOpen}
            aria-controls="message-attachment-menu"
            onClick={() => setAttachmentMenuOpen((open) => !open)}
          >
            <Paperclip aria-hidden="true" className="size-5" />
          </Button>
          <VoiceNoteRecorder
            disabled={
              send.isPending ||
              sendMedia.isPending ||
              preparingFile ||
              locating ||
              Boolean(
                selectedPhotos.length ||
                  selectedVideo ||
                  selectedVoiceNote ||
                  selectedFile ||
                  selectedLocation,
              )
            }
            onRecorded={(note) => {
              setSelectedPhotos([]);
              setSelectedVideo(null);
              setSelectedLocation(null);
              setSelectedVoiceNote(note);
              form.setValue("body", note.transcript, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              });
              setPhotoError(note.transcriptionError ?? null);
            }}
            onError={setPhotoError}
            onRecordingChange={setRecordingVoiceNote}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-white/65 sm:size-10"
            title={emojiPickerOpen ? "Close emoji picker" : "Open emoji picker"}
            aria-label={emojiPickerOpen ? "Close emoji picker" : "Open emoji picker"}
            aria-expanded={emojiPickerOpen}
            aria-controls="message-emoji-picker"
            onClick={() => setEmojiPickerOpen((open) => !open)}
          >
            <Smile aria-hidden="true" className="size-5" />
          </Button>
          <Input
            dir="auto"
            title={t("chat.write")}
            aria-label={t("chat.write")}
            placeholder={
              selectedPhotos.length || selectedVideo || selectedVoiceNote || selectedFile || selectedLocation
                ? t("chat.caption")
                : selectedReplyIds.length
                  ? t("chat.replyTo", { count: selectedReplyIds.length })
                  : t("chat.write")
            }
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-2xl border-white/10 bg-white/[0.035] px-3 text-base transition-colors duration-200 focus:border-(--accent)/50 sm:px-4"
            {...composerBodyRegistration}
            ref={(element) => {
              composerBodyRegistration.ref(element);
              composerInputRef.current = element;
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 sm:size-10"
            aria-label={
              selectedLocation
                ? "Send encrypted location"
                : selectedFile
                ? `Send ${selectedFile.encrypted.name}`
                : selectedVoiceNote
                ? "Send voice note"
                : selectedPhotos.length > 1
                  ? `Send ${selectedPhotos.length} photos`
                : selectedPhoto || selectedVideo
                  ? `Send ${selectedVideo ? "video" : "photo"}`
                  : selectedReplyIds.length
                    ? t("chat.sendReply")
                  : t("chat.send")
            }
            disabled={
              send.isPending ||
              sendMedia.isPending ||
              preparingFile ||
              recordingVoiceNote ||
              locating ||
              (!selectedPhotos.length &&
                !selectedVideo &&
                !selectedVoiceNote &&
                !selectedFile &&
                !selectedLocation &&
                !composerBody.trim())
            }
          >
            <Send aria-hidden="true" className="size-4" />
          </Button>
        </form>
        {sendMedia.isPending ? (
          <p role="status" className="mt-2 text-center text-xs text-white/50">
            {selectedVoiceNote
              ? "Checking caption links, encrypting, and uploading voice note…"
              : selectedFile
                ? "Checking caption links and uploading encrypted file…"
              : selectedVideo
              ? "Checking caption links, compressing video, encrypting, and uploading… This may take up to the clip length."
              : "Checking caption links, encrypting, and uploading photo…"}
          </p>
        ) : null}
        {send.isPending ? (
          <p role="status" className="mt-2 text-center text-xs text-white/50">
            Checking message links and sending securely…
          </p>
        ) : sentNotice ? (
          <p role="status" className="inbox-send-success mt-2 text-center text-xs text-emerald-200/90">
            Sent
          </p>
        ) : null}
        {preparingFile ? (
          <p role="status" className="mt-2 text-center text-xs text-white/50">
            Checking the document format and encrypting it on this device…
          </p>
        ) : null}
        {photoError ? (
          <p role="alert" className="mt-2 text-center text-xs text-red-300">
            {photoError}
          </p>
        ) : null}
        {sendMedia.error ? (
          <p role="alert" className="mt-2 text-center text-xs text-red-300">
            {sendMedia.error.message}
          </p>
        ) : null}
      </div>
      {send.error ? (
        <p className="border-t border-red-400/20 px-4 py-2 text-sm text-red-300">
          {send.error instanceof Error ? send.error.message : "Could not send message."}
        </p>
      ) : null}
      {photoEditorOpen && selectedPhoto ? (
        <PhotoEditor
          file={selectedPhoto}
          onCancel={() => {
            setPhotoEditorOpen(false);
            setSelectedPhotos([]);
          }}
          onSave={(file) => {
            setSelectedPhotos(file ? [file] : []);
            setPhotoEditorOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function UnlockPanel({
  error: logoutError,
  loggingOut,
  onLogout,
  onUnlock,
}: {
  error: string | null;
  loggingOut: boolean;
  onLogout: () => Promise<void>;
  onUnlock: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: "" },
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        className="w-full max-w-md space-y-5 rounded-[2rem] border border-white/10 bg-white/[0.03] p-8"
        onSubmit={form.handleSubmit(async ({ password }) => {
          setError(null);
          try {
            await bootstrapDevice(password);
            onUnlock();
          } catch {
            setError(t("inbox.unlockFailed"));
          }
        })}
      >
        <p className="text-xs text-(--accent)">{t("inbox.unlockEyebrow")}</p>
        <h1 className="text-3xl font-semibold">{t("inbox.unlockTitle")}</h1>
        <p className="text-sm text-white/45">{t("inbox.unlockBody")}</p>
        {logoutError ? <p className="text-sm text-red-300">{logoutError}</p> : null}
        <Input type="password" dir="ltr" placeholder={t("auth.password")} {...form.register("password")} />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" className="w-full">
          {t("inbox.unlock")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={loggingOut}
          onClick={() => void onLogout()}
        >
          {loggingOut ? t("inbox.loggingOut") : t("auth.signOut")}
        </Button>
      </form>
    </main>
  );
}
