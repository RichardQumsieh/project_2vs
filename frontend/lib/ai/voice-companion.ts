import type { LocalMessage } from "../crypto/types";
import type { VoiceMode } from "./assistant-settings";

export type SpeechVoice = {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
};

export type SpeechRequest = {
  text: string;
  language: "en" | "ar";
  voiceURI: string;
  rate: number;
};

export type TextToSpeechProvider = {
  getVoices(): SpeechVoice[];
  isSpeaking(): boolean;
  speak(request: SpeechRequest, signal: AbortSignal): Promise<void>;
  cancel(): void;
};

export type SpeechQueue = {
  speakOnce(key: string, request: SpeechRequest): Promise<boolean>;
  isSpeaking(): boolean;
  cancel(): void;
};

export function createIncomingSpeechTracker() {
  let initialized = false;
  let observedConversationId = "";
  let observedId: string | null = null;
  let eligibleId: string | null = null;

  return {
    observe(conversationId: string, messageId: string | null) {
      if (!initialized || conversationId !== observedConversationId) {
        initialized = true;
        observedConversationId = conversationId;
        observedId = messageId;
        eligibleId = null;
        return;
      }
      if (messageId !== observedId) {
        observedId = messageId;
        eligibleId = messageId;
      }
      if (messageId === null) {
        eligibleId = null;
      }
    },
    isEligible(conversationId: string, messageId: string | null) {
      return (
        messageId !== null &&
        conversationId === observedConversationId &&
        eligibleId === messageId
      );
    },
  };
}

export function createBrowserSpeechProvider(
  synthesis: SpeechSynthesis | undefined =
    typeof window === "undefined" ? undefined : window.speechSynthesis,
  Utterance: typeof SpeechSynthesisUtterance | undefined =
    typeof window === "undefined" ? undefined : window.SpeechSynthesisUtterance,
): TextToSpeechProvider {
  let activeUtterance: SpeechSynthesisUtterance | undefined;

  return {
    getVoices() {
      return synthesis?.getVoices().map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        default: voice.default,
        localService: voice.localService,
      })) ?? [];
    },
    isSpeaking() {
      return Boolean(synthesis?.speaking || synthesis?.pending);
    },
    speak(request, signal) {
      if (!synthesis || !Utterance) {
        return Promise.reject(
          new Error("Speech synthesis is not available in this browser."),
        );
      }
      if (signal.aborted) {
        return Promise.reject(abortError());
      }
      if (synthesis.speaking || synthesis.pending) {
        return Promise.reject(
          new Error("Audio is already playing. Stop it before speaking a reply."),
        );
      }

      const nativeVoices = synthesis.getVoices();
      const selectedVoice = chooseSpeechVoice(
        nativeVoices.map((item) => ({
          voiceURI: item.voiceURI,
          name: item.name,
          lang: item.lang,
          default: item.default,
          localService: item.localService,
        })),
        request.language,
        request.voiceURI,
      );
      const voice = selectedVoice
        ? nativeVoices.find(
            (item) =>
              item.voiceURI === selectedVoice.voiceURI &&
              item.localService,
          )
        : undefined;
      if (!voice) {
        return Promise.reject(
          new Error(
            `No local ${request.language === "ar" ? "Arabic" : "English"} speech voice is installed in this browser.`,
          ),
        );
      }
      const utterance = new Utterance(request.text);
      utterance.lang = voice.lang;
      utterance.rate = Math.min(1.3, Math.max(0.7, request.rate));
      utterance.voice = voice;
      activeUtterance = utterance;

      return new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(watchdog);
          signal.removeEventListener("abort", onAbort);
          if (activeUtterance === utterance) {
            activeUtterance = undefined;
          }
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        const onAbort = () => {
          if (activeUtterance === utterance) {
            activeUtterance = undefined;
            synthesis.cancel();
          }
          finish(abortError());
        };
        const watchdog = setTimeout(() => {
          if (activeUtterance === utterance) {
            activeUtterance = undefined;
            synthesis.cancel();
          }
          finish(
            new Error(
              "Speech did not finish. The browser voice may have stopped unexpectedly; try again.",
            ),
          );
        }, Math.min(45_000, Math.max(8_000, request.text.length * 250 / utterance.rate)));

        utterance.onend = () => finish();
        utterance.onerror = (event) => {
          if (event.error === "canceled" || event.error === "interrupted") {
            finish(abortError());
          } else {
            finish(new Error("The selected browser voice could not speak this reply."));
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          synthesis.speak(utterance);
        } catch (error) {
          finish(
            new Error(
              error instanceof Error
                ? `The browser could not start its local speech voice: ${error.message}`
                : "The browser could not start its local speech voice.",
            ),
          );
        }
      });
    },
    cancel() {
      if (activeUtterance && synthesis) {
        activeUtterance = undefined;
        synthesis.cancel();
      }
    },
  };
}

export function createSpeechQueue(
  provider: TextToSpeechProvider,
): SpeechQueue {
  let controller: AbortController | undefined;
  let activeKey: string | undefined;

  function cancel() {
    const currentController = controller;
    controller = undefined;
    activeKey = undefined;
    if (currentController) {
      currentController.abort();
      provider.cancel();
    }
  }

  return {
    isSpeaking() {
      return controller !== undefined;
    },
    async speakOnce(key, request) {
      cancel();
      const nextController = new AbortController();
      controller = nextController;
      activeKey = key;

      try {
        await provider.speak(request, nextController.signal);
        if (nextController.signal.aborted || activeKey !== key) {
          return false;
        }
        return true;
      } catch (error) {
        if (
          nextController.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return false;
        }
        throw error;
      } finally {
        if (controller === nextController) {
          controller = undefined;
          activeKey = undefined;
        }
      }
    },
    cancel,
  };
}

export function chooseSpeechVoice(
  voices: SpeechVoice[],
  language: "en" | "ar",
  voiceURI = "",
) {
  const localVoices = voices.filter((voice) => voice.localService);
  if (voiceURI) {
    const selected = localVoices.find((voice) => voice.voiceURI === voiceURI);
    if (selected) {
      return selected;
    }
  }

  const prefix = language === "ar" ? "ar" : "en";
  return (
    localVoices.find((voice) => voice.lang.toLowerCase().startsWith(`${prefix}-`)) ??
    localVoices.find((voice) => voice.lang.toLowerCase() === prefix)
  );
}

export function speechLanguage(text: string): "en" | "ar" {
  return /\p{Script=Arabic}/u.test(text) ? "ar" : "en";
}

const sensitiveContentPattern =
  /\b(suicid\w*|self[- ]?harm|kill myself|harm(?:ing)? myself|hurt(?:ing)? myself|abuse|assault|rape|cancer|diagnos\w*|hospital|doctor|medicat\w*|prescription|bank|password|passcode|one[- ]time code|verification code|credit card|card number|social security|home address|my address|my location|pregnan\w*|divorc\w*|death|died|funeral|laid off|fired|salary|debt|loan|therapy|therapist|panic attack)\b|انتحار|أنتحر|انتح|إيذاء|اعتداء|اغتصاب|سرطان|تشخيص|مستشفى|طبيب|دواء|وصفة|بنك|كلمة المرور|رمز التحقق|بطاقة ائتمان|عنوان بيتي|موقعي|حامل|طلاق|وفاة|مات|جنازة|راتب|دين|قرض|معالج نفسي|نوبة هلع/i;

const automaticSpeechAllowlist =
  /^(?:hi(?: there| buddy)?|hey(?: there| buddy)?|hello(?: there)?|good morning|good evening|how are you|how's it going|what's up|i'm good|im good|i'm doing well|im doing well|thanks|thank you|sure|yes|no|okay|ok|sounds good|that works|great|perfect|see you|see you then|i'd love to|id love to|are you free(?: later| tonight| tomorrow| for coffee)?|what time works for you|what time|want to (?:get )?(?:coffee|lunch|dinner)|let's meet for (?:coffee|lunch|dinner)|lets meet for (?:coffee|lunch|dinner)|مرحبا|أهلا|اهلا|هلا|كيفك|شو الأخبار|شو الاخبار|تمام|منيح|يسعد صباحك|يسعد مساك|بكرا|أي ساعة|اي ساعة|متى نتلاقى|نتلاقى بكرا|بدك قهوة|قهوة|أكيد|اكيد|ماشي|شكرا|يسلمو|كيف الحال|كفك|كيفك|شو أخبارك|شو اخبارك|تمام بشوفك|هههه|ههههه|keefak|kefak|shu akhbarak|tamam)(?:[.!?؟،]*)$/i;

export function isSafeForAutomaticSpeech(messages: LocalMessage[]) {
  const latest = messages[messages.length - 1];
  if (!latest || latest.fromMe) {
    return false;
  }

  return messages
    .filter((message) => message.conversationId === latest.conversationId)
    .slice(-6)
    .every((message) => isAllowedAutomaticSpeechText(message.plaintext));
}

export function isAllowedAutomaticSpeechText(text: string) {
  return (
    text.length <= 140 &&
    isSafeSpeechText(text) &&
    automaticSpeechAllowlist.test(text.trim())
  );
}

export function isSafeSpeechText(text: string) {
  if (
    sensitiveContentPattern.test(text) ||
    /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(text) ||
    /[\p{N}][\p{N}\s().+-]{7,}[\p{N}]/u.test(text) ||
    /https?:\/\/|www\./i.test(text)
  ) {
    return false;
  }

  return true;
}

export function canSpeakAutomatically({
  mode,
  muted,
  visible,
  otherAudioPlaying,
  messages,
}: {
  mode: VoiceMode;
  muted: boolean;
  visible: boolean;
  otherAudioPlaying: boolean;
  messages: LocalMessage[];
}) {
  return (
    mode === "automatic" &&
    !muted &&
    visible &&
    !otherAudioPlaying &&
    isSafeForAutomaticSpeech(messages)
  );
}

function abortError() {
  return new DOMException("Speech cancelled", "AbortError");
}
