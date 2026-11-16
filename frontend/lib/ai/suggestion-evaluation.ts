import type { LocalMessage } from "../crypto/types";
import type { SummaryLanguage, SummaryTone } from "./types";

export type SuggestionEvaluationCase = {
  id: string;
  language: SummaryLanguage;
  tone: SummaryTone;
  messages: Array<Pick<LocalMessage, "fromMe" | "plaintext">>;
  criteria: string[];
};

export const suggestionEvaluationCases: SuggestionEvaluationCase[] = [
  {
    id: "english-casual",
    language: "english",
    tone: "concise",
    messages: [
      { fromMe: true, plaintext: "That new cafe looks good." },
      { fromMe: false, plaintext: "Want to try it this weekend?" },
    ],
    criteria: ["answer the invitation", "sound conversational", "no invented plan"],
  },
  {
    id: "arabic-levantine",
    language: "arabic",
    tone: "warm",
    messages: [
      { fromMe: true, plaintext: "كيف كان يومك؟" },
      { fromMe: false, plaintext: "كان طويل والله، خلصت شغل متأخر" },
    ],
    criteria: ["respond in Arabic", "show empathy", "avoid forced humor"],
  },
  {
    id: "mixed-code-switching",
    language: "auto",
    tone: "concise",
    messages: [
      { fromMe: true, plaintext: "بكرا بنراجع الخطة" },
      { fromMe: false, plaintext: "تمام, send me the latest version قبل الاجتماع" },
    ],
    criteria: ["preserve natural code-switching", "acknowledge the request"],
  },
  {
    id: "playful-humor",
    language: "english",
    tone: "playful",
    messages: [
      { fromMe: true, plaintext: "I managed to burn toast again." },
      { fromMe: false, plaintext: "At this point the toaster is winning 😂" },
    ],
    criteria: ["recognize playful banter", "light humor is appropriate"],
  },
  {
    id: "professional-advice",
    language: "english",
    tone: "professional",
    messages: [
      { fromMe: true, plaintext: "We may miss Friday's deadline because review is blocked." },
      { fromMe: false, plaintext: "Can you suggest what we should tell the client?" },
    ],
    criteria: ["professional tone", "offer practical options", "do not invent facts"],
  },
  {
    id: "serious-support",
    language: "english",
    tone: "playful",
    messages: [
      { fromMe: true, plaintext: "I have been overwhelmed since my father's diagnosis." },
      { fromMe: false, plaintext: "I don't know how to handle all of this." },
    ],
    criteria: ["show empathy", "no humor", "do not give presumptive medical advice"],
  },
];
