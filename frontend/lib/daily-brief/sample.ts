import type { DailyBriefDocument } from "./types";

const boardId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";

export function sampleDailyBrief(language: "en" | "ar"): DailyBriefDocument {
  const arabic = language === "ar";
  return {
    localDate: "2026-11-20",
    timeZone: "Asia/Amman",
    language,
    generatedAt: "2026-11-20T04:00:00.000Z",
    source: "morning",
    mode: "mock",
    narrative: arabic
      ? "اليوم عندك اجتماعين. مراجعة البورد بتتعارض مع مكالمة الزبون. الأولوية للرد على لينا. في متابعة متأخرة. الاقتراحات بتستنى موافقتك. ما انبعت إشي ولا تغيّر."
      : "Today you have 2 meetings. Board review conflicts with the client call. Reply first to Lina. 1 follow-up is overdue. Suggestions wait for your approval. Nothing was sent or changed.",
    meetings: [
      {
        id: boardId,
        title: arabic ? "مراجعة البورد" : "Board review",
        startsAt: "2026-11-20T06:00:00.000Z",
        endsAt: "2026-11-20T07:00:00.000Z",
        allDay: false,
        prepNote: arabic
          ? "راجع رسالة لينا عن «البورد ديك لازم اليوم»."
          : "Prep: read Lina on “Board deck due today”.",
        conflictsWith: [arabic ? "مكالمة الزبون" : "Client call"],
      },
      {
        id: clientId,
        title: arabic ? "مكالمة الزبون" : "Client call",
        startsAt: "2026-11-20T06:30:00.000Z",
        endsAt: "2026-11-20T07:00:00.000Z",
        allDay: false,
        prepNote: arabic
          ? "راجع جدول الاجتماع قبل ما يبدأ."
          : "Prep: review the agenda before it starts.",
        conflictsWith: [arabic ? "مراجعة البورد" : "Board review"],
      },
    ],
    needsReply: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        fromAddress: "lina@acme.com",
        subject: arabic ? "البورد ديك لازم اليوم" : "Board deck due today",
        receivedAt: "2026-11-20T05:00:00.000Z",
        urgency: "high",
        reason: arabic ? "مستعجلة وبدها رد." : "Urgent and needs a reply.",
      },
    ],
    overdueFollowUps: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        fromAddress: "omar@client.example",
        subject: arabic ? "متابعة العرض" : "Following up on the proposal",
        receivedAt: "2026-11-17T06:30:00.000Z",
        daysOverdue: 3,
      },
    ],
    actions: [
      {
        id: "brief-draft-lina",
        kind: "draft_reply",
        title: arabic ? "مسودة رد لـ لينا" : "Draft a reply to Lina",
        detail: arabic
          ? "الموافقة تحفظ مسودة فقط. ما بينبعت الإيميل."
          : "Approval saves a draft only. The email is not sent.",
        approvalRequired: true,
        approval: {
          action: "save_draft",
          provider: "gmail",
          idempotencyKey: "brief20261120draftlina",
          payload: {
            to: ["lina@acme.com"],
            subject: arabic ? "Re: البورد ديك لازم اليوم" : "Re: Board deck due today",
            body: arabic
              ? "لينا، الديك بيكون جاهز اليوم. هاي مسودة وما انرسلت."
              : "Lina — the deck will be ready today. This is a draft and was not sent.",
          },
        },
      },
      {
        id: "brief-move-client",
        kind: "reschedule",
        title: arabic ? "اقتراح تأجيل مكالمة الزبون" : "Propose moving Client call",
        detail: arabic
          ? "بعد مراجعة البورد. ما بيتغير التقويم قبل الموافقة."
          : "After Board review. The calendar does not change until you approve.",
        approvalRequired: true,
        approval: {
          action: "reschedule_event",
          provider: "google",
          idempotencyKey: "brief20261120moveclient",
          payload: {
            externalEventId: "evt-client",
            title: arabic ? "مكالمة الزبون" : "Client call",
            startsAt: "2026-11-20T07:00:00.000Z",
            endsAt: "2026-11-20T07:30:00.000Z",
            allDay: false,
          },
        },
      },
      {
        id: "brief-decline-client",
        kind: "decline",
        title: arabic ? "رفض مكالمة الزبون" : "Decline Client call",
        detail: arabic
          ? "الموافقة تحذف الحدث من التقويم. ما بينحذف شي قبل ما توافق."
          : "Approval removes this event from the calendar. Nothing is removed until you approve.",
        approvalRequired: true,
        approval: {
          action: "delete_event",
          provider: "google",
          idempotencyKey: "brief20261120declineclient",
          payload: { eventId: clientId },
        },
      },
    ],
  };
}
