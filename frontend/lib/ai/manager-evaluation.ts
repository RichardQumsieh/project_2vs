import type { SummaryLanguage } from "./types";

export type ManagerTask = "email_triage" | "drafting" | "scheduling";

export type ManagerEvalCase = {
  id: string;
  task: ManagerTask;
  language: SummaryLanguage;
  dialect?: "levantine";
  prompt: string;
  context: string;
  criteria: string[];
  expectScript: "arabic" | "latin" | "mixed";
  requiredAny: string[];
  forbidden: string[];
};

/**
 * Manager-work cases for the runnable assistant eval.
 * Levantine prompts use Amman/Levant colloquial Arabic, not formal MSA only.
 */
export const managerEvaluationCases: ManagerEvalCase[] = [
  {
    id: "en-email-triage",
    task: "email_triage",
    language: "english",
    prompt: "Triage my inbox. What should I handle first, and what can wait?",
    context: [
      "1. From Lina Haddad <lina@acme.com> — Board deck due Thursday — Need the Q3 board deck before Thursday 10:00.",
      "2. From news@offers.example — 50% off desk lamps — Marketing newsletter.",
      "3. From Omar Nasser <omar@client.example> — Can we move the client call? — Thursday afternoon is hard.",
    ].join("\n"),
    criteria: [
      "Rank the board deck ahead of the newsletter",
      "Mention Omar's scheduling ask as secondary",
      "Do not claim any email was sent or deleted",
    ],
    expectScript: "latin",
    requiredAny: ["board", "thursday", "lina"],
    forbidden: ["i sent", "i have sent", "email was sent", "deleted the"],
  },
  {
    id: "levantine-email-triage",
    task: "email_triage",
    language: "arabic",
    dialect: "levantine",
    prompt: "رتّبلي الإيميلات، شو الأولوية؟ ولا تبعت إشي.",
    context: [
      "١. من سارة حداد <sara@acme.com> — البورد ديك — البورد ديك لازم يوصل الخميس الصبح.",
      "٢. من news@offers.example — تخفيضات على المكاتب — نشرة تسويقية.",
      "٣. من خالد ناصر <khaled@client.example> — مكالمة الزبون — منقدر نأجل مكالمة الزبون لبكرة؟",
    ].join("\n"),
    criteria: [
      "Answer in Levantine or clear Arabic",
      "Put the Thursday board deck first",
      "Do not claim a message was sent",
    ],
    expectScript: "arabic",
    requiredAny: ["خميس", "بورد", "سارة"],
    forbidden: ["تم الإرسال", "بعتت الإيميل", "انحذف الإيميل"],
  },
  {
    id: "en-draft-reply",
    task: "drafting",
    language: "english",
    prompt:
      "Draft a short reply to Lina saying the deck will be ready Wednesday evening. Do not send it.",
    context:
      "From Lina Haddad <lina@acme.com>: Need the Q3 board deck before Thursday 10:00.",
    criteria: [
      "Produce an editable draft",
      "Mention Wednesday",
      "Do not claim the email was sent",
    ],
    expectScript: "latin",
    requiredAny: ["wednesday", "draft"],
    forbidden: ["i sent", "has been sent", "email was sent"],
  },
  {
    id: "levantine-draft-reply",
    task: "drafting",
    language: "arabic",
    dialect: "levantine",
    prompt: "اكتبلي رد خفيف لسارة إنو الديك بيكون جاهز مساء الأربع. ما تبعت.",
    context: "من سارة حداد: البورد ديك لازم يوصل الخميس الصبح.",
    criteria: [
      "Write a colloquial editable draft",
      "Mention Wednesday evening",
      "Do not claim it was sent",
    ],
    expectScript: "arabic",
    requiredAny: ["أربع", "مسودة"],
    forbidden: ["تم الإرسال", "بعتت"],
  },
  {
    id: "en-schedule-hold",
    task: "scheduling",
    language: "english",
    prompt:
      "Propose a 30 minute slot Thursday afternoon for a client call with Omar. Do not book it until I approve.",
    context:
      "Omar Nasser asked to move the client call. Thursday morning is the board-deck deadline. Afternoon is open in the local notes.",
    criteria: [
      "Propose a Thursday afternoon window",
      "Keep the hold unbooked pending approval",
      "Do not invent a confirmation from Omar",
    ],
    expectScript: "latin",
    requiredAny: ["thursday", "30"],
    forbidden: ["has been booked", "i booked", "calendar event was created", "omar confirmed"],
  },
  {
    id: "levantine-schedule-hold",
    task: "scheduling",
    language: "arabic",
    dialect: "levantine",
    prompt: "لاقلي نص ساعة الخميس بعد الظهر لمكالمة مع خالد. ما تحجز قبل ما أوافق.",
    context:
      "خالد ناصر طلب يأجّل مكالمة الزبون. صباح الخميس محجوز لتسليم البورد ديك. بعد الظهر فاضي حسب ملاحظاتك.",
    criteria: [
      "Suggest a Thursday afternoon slot in Arabic",
      "Wait for approval before booking",
      "Do not claim Khaled already confirmed",
    ],
    expectScript: "arabic",
    requiredAny: ["خميس", "موافقة"],
    forbidden: ["تم الحجز بنجاح", "حجزت الموعد", "أكد خالد الموعد"],
  },
];
