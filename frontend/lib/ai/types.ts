import type { LocalMessage } from "../crypto/types";

export type SummaryLanguage =
  | "auto"
  | "english"
  | "arabic";

export type SummaryTone =
  | "concise"
  | "professional"
  | "warm"
  | "playful";

export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type InferenceProgress = {
  phase: "loading" | "generating";
  percent?: number;
};

export type LocalInferenceProvider = {
  generate(
    messages: ChatTurn[],
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: InferenceProgress) => void;
      onChunk?: (chunk: string) => void;
      onReset?: () => void;
      stream?: boolean;
      maxNewTokens?: number;
      doSample?: boolean;
      temperature?: number;
      topP?: number;
    },
  ): Promise<string>;
};

export type SummaryRequest = {
  conversationId: string;
  messages: LocalMessage[];
  language: SummaryLanguage;
  tone: SummaryTone;
};
