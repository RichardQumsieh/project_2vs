"use client";

import { ExperimentalBadge } from "@/components/experimental-badge";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SophiaMark } from "@/components/sophia-mark";
import { SophiaProposalCard } from "@/components/sophia-proposal-card";
import { ThreadMessageList } from "@/components/thread-message-list";
import type { AgentProposal } from "@/lib/ai/agent-runtime";
import type { LocalMessage } from "@/lib/crypto/types";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n } from "@/lib/i18n/locale";

const messages: LocalMessage[] = [
  {
    id: "m1",
    conversationId: "preview",
    senderDeviceId: "peer",
    fromMe: false,
    plaintext: "البورد ديك لازم يوصل الخميس الصبح. Can you confirm the Wednesday draft?",
    createdAt: "2026-11-19T08:00:00.000Z",
  },
  {
    id: "m2",
    conversationId: "preview",
    senderDeviceId: "me",
    fromMe: true,
    plaintext: "أكيد، the deck will be ready Wednesday evening — sara@acme.com.",
    createdAt: "2026-11-19T08:05:00.000Z",
  },
];

const emailProposal: AgentProposal = {
  id: "preview-email",
  createdAt: Date.now(),
  expiresAt: Date.now() + 60 * 60 * 1000,
  provenance: "command",
  action: {
    type: "draft_email",
    provider: "gmail",
    to: ["sara@acme.com"],
    subject: "البورد ديك — Wednesday",
    body: "سارة، الديك بيكون جاهز مساء الأربع.\nThe deck will be ready Wednesday evening.",
    delivery: "draft",
  },
};

const eventProposal: AgentProposal = {
  id: "preview-event",
  createdAt: Date.now(),
  expiresAt: Date.now() + 60 * 60 * 1000,
  provenance: "command",
  action: {
    type: "create_calendar_event",
    provider: "google",
    title: "مكالمة مع خالد",
    startsAt: "2026-11-19T14:00:00",
    endsAt: "2026-11-19T14:30:00",
    description: "30 minutes · نص ساعة",
  },
};

export function MobileFlowPreview({
  surface,
}: {
  surface: "inbox" | "chat" | "approvals";
}) {
  const { t } = useI18n();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-[#070b12] text-white">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <SophiaMark />
          <span className="text-sm font-semibold">Sophia</span>
          <ExperimentalBadge />
        </div>
        <LanguageSwitcher />
      </div>
      {surface === "inbox" ? <InboxSurface /> : null}
      {surface === "chat" ? <ChatSurface /> : null}
      {surface === "approvals" ? (
        <section className="min-w-0 space-y-3 p-3" aria-label={t("approval.region")}>
          <h1 className="text-lg font-semibold">{t("mail.title")}</h1>
          <p className="text-sm text-white/55">{t("preview.approvalHint")}</p>
          <SophiaProposalCard proposal={emailProposal} onApprove={() => {}} onCancel={() => {}} />
          <SophiaProposalCard proposal={eventProposal} onApprove={() => {}} onCancel={() => {}} />
        </section>
      ) : null}
    </main>
  );
}

function InboxSurface() {
  const { t } = useI18n();
  const threads = [
    { name: "سارة حداد", handle: "sara", preview: "البورد ديك لازم الخميس" },
    { name: "Omar Nasser", handle: "omar", preview: "Can we move the client call?" },
    { name: "خالد ناصر", handle: "khaled", preview: "منقدر نأجل لبكرة؟" },
  ];
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="space-y-3 border-b border-white/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold">{t("inbox.title")}</h1>
          <span className="text-xs text-white/50">{t("inbox.settings")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 px-3 text-sm">
            {t("inbox.compose")}
          </span>
          <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 px-3 text-sm">
            {t("inbox.schedule")}
          </span>
        </div>
        <p className="text-xs text-white/55">{t("inbox.recent")}</p>
      </header>
      <nav aria-label={t("inbox.conversations")} className="min-w-0 flex-1 space-y-2 p-3">
        <p className="text-xs leading-5 text-white/45">{t("preview.inboxHint")}</p>
        {threads.map((thread) => (
          <article key={thread.handle} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 px-3 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-cyan-300/10 text-xs">
              {thread.name.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <BidiText className="block truncate text-sm font-medium">{thread.name}</BidiText>
              <span className="mt-0.5 block truncate text-xs text-white/40">
                <LtrIsolate>@{thread.handle}</LtrIsolate>
                {" · "}
                <BidiText>{thread.preview}</BidiText>
              </span>
            </span>
          </article>
        ))}
      </nav>
    </section>
  );
}

function ChatSurface() {
  const { t } = useI18n();
  return (
    <section className="thread-stage flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="thread-header flex min-w-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">
            <BidiText>سارة حداد</BidiText>
          </h1>
          <p className="truncate text-xs text-white/45">
            {t("chat.encrypted")}
            {" · "}
            <LtrIsolate>@sara</LtrIsolate>
          </p>
        </div>
        <div className="thread-header-actions items-center">
          <span className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 text-xs">
            {t("chat.reply")}
          </span>
          <span className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 text-xs">
            {t("chat.talkSophia")}
          </span>
          <ExperimentalBadge />
        </div>
      </header>
      <div className="thread-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
        <p className="text-xs text-white/40">{t("preview.chatHint")}</p>
        <ThreadMessageList
          messages={messages}
          conversationId="preview"
          replySelectMode={false}
          selectedReplyIds={[]}
          confirmDeleteId={null}
          deleteMessageError={null}
          deletePending={false}
          onToggleReply={() => {}}
          onAskDelete={() => {}}
          onConfirmDelete={() => {}}
          onCancelDelete={() => {}}
        />
      </div>
      <form className="composer-bar flex min-w-0 items-center gap-2 border-t border-white/10 p-3">
        <input
          dir="auto"
          className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-base"
          placeholder={t("chat.write")}
          aria-label={t("chat.write")}
          defaultValue="تمام, Wednesday evening يمشي"
        />
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-black">
          {t("chat.send")}
        </button>
      </form>
    </section>
  );
}
