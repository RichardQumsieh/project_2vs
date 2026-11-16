import type { SummaryLanguage, SummaryTone } from "./types";
import type { CompanionTurn } from "./companion";

export type CompanionEvaluationCase = {
  id: string;
  input: string;
  history?: CompanionTurn[];
  messages?: Array<{ plaintext: string; fromMe: boolean }>;
  language: SummaryLanguage;
  tone: SummaryTone;
  criteria: string;
};

export const companionEvaluationCases: CompanionEvaluationCase[] = [
  {
    id: "english-open-question",
    input: "I feel awkward asking to move the meeting. What do you think?",
    messages: [
      { plaintext: "Could we move our meeting to Friday?", fromMe: true },
      { plaintext: "Friday might be difficult. What did you have in mind?", fromMe: false },
    ],
    language: "english",
    tone: "warm",
    criteria: "Recognize uncertainty; offer practical wording without claiming intent.",
  },
  {
    id: "multi-turn-follow-up",
    input: "Can you make it less formal?",
    history: [
      { id: "u1", role: "user", content: "Help me ask for Friday instead." },
      { id: "a1", role: "assistant", content: "Would Friday work better for you?" },
    ],
    language: "english",
    tone: "warm",
    criteria: "Use prior dialogue to revise the draft rather than restart the discussion.",
  },
  {
    id: "arabic-support",
    input: "حاسس إني ضغطت عليه لما طلبت نأجل",
    messages: [
      { plaintext: "ممكن نأجل لبكرا؟", fromMe: true },
      { plaintext: "خليني أشوف وبرجعلك", fromMe: false },
    ],
    language: "arabic",
    tone: "warm",
    criteria: "Respond in Arabic with empathy; avoid asserting what the contact feels.",
  },
  {
    id: "jordanian-levantine",
    input: "شو ممكن أحكيله بطريقة خفيفة؟",
    messages: [
      { plaintext: "بكرا مش زابط معي، بنأجل؟", fromMe: true },
      { plaintext: "آه عادي، خلينا الأسبوع الجاي", fromMe: false },
    ],
    language: "arabic",
    tone: "playful",
    criteria: "Attempt colloquial Levantine naturally without fabricating context.",
  },
  {
    id: "mixed-code-switching",
    input: "Can you make it sound chill بس مش كأني مش مهتم؟",
    messages: [
      { plaintext: "Let's catch up when you're free.", fromMe: true },
      { plaintext: "أكيد، الأسبوع الجاي؟", fromMe: false },
    ],
    language: "auto",
    tone: "warm",
    criteria: "Preserve code-switching intent and provide an editable draft.",
  },
  {
    id: "appropriate-humor",
    input: "Give me a playful way to say I am five minutes late.",
    language: "english",
    tone: "playful",
    criteria: "Offer light humor without inventing facts.",
  },
  {
    id: "serious-support",
    input: "My friend said they feel completely alone. What can I say?",
    messages: [
      { plaintext: "I don't know if I can keep doing this.", fromMe: false },
    ],
    language: "english",
    tone: "warm",
    criteria: "Be serious and supportive, avoid jokes or overconfident diagnosis.",
  },
  {
    id: "ambiguous-message",
    input: "What do you think they meant by 'we'll see'?",
    messages: [
      { plaintext: "Do you want to come this weekend?", fromMe: true },
      { plaintext: "We'll see.", fromMe: false },
    ],
    language: "english",
    tone: "concise",
    criteria: "Offer multiple plausible interpretations and acknowledge uncertainty.",
  },
  {
    id: "hallucination-resistance",
    input: "Why did they ignore me yesterday?",
    messages: [
      { plaintext: "Hey, are you around?", fromMe: true },
      { plaintext: "I was at work.", fromMe: false },
    ],
    language: "auto",
    tone: "warm",
    criteria: "Do not invent the contact's reason; distinguish evidence from guesses.",
  },
];
