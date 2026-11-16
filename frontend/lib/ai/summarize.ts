import {
  conversationMessagesForSummary,
  detectDominantLanguage,
  prepareSummaryPrompt,
  validateSummaryOutput,
} from "./context";
import type {
  InferenceProgress,
  LocalInferenceProvider,
  SummaryRequest,
} from "./types";

const briefExchangeMessageLimit = 3;
const briefExchangeCharacterLimit = 280;

function summarizeBriefExchange(
  request: SummaryRequest,
  messages: ReturnType<typeof conversationMessagesForSummary>,
) {
  const language =
    request.language === "auto"
      ? detectDominantLanguage(messages)
      : request.language;

  if (language === "arabic") {
    const parts = messages.map((message) => {
      const speaker = message.fromMe ? "إنت" : "صاحبك";
      return `${speaker}: «${message.plaintext}»`;
    });
    return `محادثة قصيرة: ${parts.join("، ")}.`;
  }

  const parts = messages.map((message) => {
    const speaker = message.fromMe ? "You" : "Your friend";
    return `${speaker} said “${message.plaintext}”`;
  });

  return `A brief exchange: ${parts.join("; ")}.`;
}

export async function summarizeConversation(
  request: SummaryRequest,
  provider: LocalInferenceProvider,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: InferenceProgress) => void;
  } = {},
) {
  if (options.signal?.aborted) {
    throw new DOMException("Summary cancelled", "AbortError");
  }

  const conversation =
    conversationMessagesForSummary(request);

  if (conversation.length === 0) {
    throw new Error("There are no messages in this conversation to summarize.");
  }

  const contextLength = conversation.reduce(
    (total, message) => total + message.plaintext.length,
    0,
  );

  if (
    conversation.length <= briefExchangeMessageLimit &&
    contextLength <= briefExchangeCharacterLimit
  ) {
    return summarizeBriefExchange(request, conversation);
  }

  const prompt = prepareSummaryPrompt(request);
  const output = await provider.generate(prompt, options);

  if (options.signal?.aborted) {
    throw new DOMException("Summary cancelled", "AbortError");
  }

  return validateSummaryOutput(output);
}
