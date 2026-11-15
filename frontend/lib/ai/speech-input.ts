export type SpeechInputLanguage = "en-US" | "ar-JO";

type RecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionConstructor = {
  new(): RecognitionLike;
  available?: (
    options: {
      langs: string[];
      processLocally: true;
    },
  ) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
};

export type SpeechInputProvider = {
  supportsBrowserRecognition(): boolean;
  isOnDeviceAvailable(language: SpeechInputLanguage): Promise<boolean>;
  listen(
    language: SpeechInputLanguage,
    options: {
      signal: AbortSignal;
      onInterim: (text: string) => void;
      allowBrowserService?: boolean;
    },
  ): Promise<string>;
  cancel(): void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

export function createOnDeviceSpeechInputProvider(
  browserWindow: SpeechRecognitionWindow | undefined =
    typeof window === "undefined"
      ? undefined
      : window as SpeechRecognitionWindow,
): SpeechInputProvider {
  let activeRecognition: RecognitionLike | undefined;
  let activeAbort: (() => void) | undefined;

  function constructor() {
    return browserWindow?.SpeechRecognition ??
      browserWindow?.webkitSpeechRecognition;
  }

  async function isOnDeviceAvailable(language: SpeechInputLanguage) {
    const Recognition = constructor();
    if (!Recognition?.available) {
      return false;
    }
    try {
      return await Recognition.available({
        langs: [language],
        processLocally: true,
      }) === "available";
    } catch {
      return false;
    }
  }

  return {
    supportsBrowserRecognition() {
      return Boolean(constructor());
    },
    isOnDeviceAvailable,
    listen(language, { signal, onInterim, allowBrowserService = false }) {
      const Recognition = constructor();
      if (!Recognition) {
        return Promise.reject(
          new Error("This browser does not expose speech recognition. You can still type."),
        );
      }
      if (signal.aborted) {
        return Promise.reject(abortError());
      }

      const recognition = new Recognition();
      const locallyAvailable = Recognition.available
        ? isOnDeviceAvailable(language)
        : Promise.resolve(false);
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      if ("processLocally" in recognition) {
        recognition.processLocally = true;
      }
      activeRecognition = recognition;

      return new Promise<string>((resolve, reject) => {
        let finalText = "";
        let settled = false;
        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          if (activeRecognition === recognition) {
            activeRecognition = undefined;
          }
          if (activeAbort === onAbort) {
            activeAbort = undefined;
          }
        };
        const finish = (error?: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          if (error) {
            reject(error);
          } else if (finalText.trim()) {
            resolve(finalText.trim());
          } else {
            reject(new Error("No speech was recognized. Try again or type instead."));
          }
        };
        const onAbort = () => {
          finish(abortError());
          recognition.abort();
        };
        activeAbort = onAbort;

        recognition.onresult = (event) => {
          const parts: string[] = [];
          for (const result of Array.from(event.results)) {
            const transcript = result[0]?.transcript ?? "";
            if (result.isFinal) {
              parts.push(transcript);
            } else {
              onInterim(transcript);
            }
          }
          if (parts.length) {
            finalText = parts.join(" ");
            onInterim(finalText);
          }
        };
        recognition.onerror = (event) => {
          finish(
            new Error(
              event.error === "not-allowed"
                ? "Microphone permission was denied. You can still type to the companion."
                : `On-device speech recognition failed (${event.error}). You can still type.`,
            ),
          );
        };
        recognition.onend = () => finish();
        signal.addEventListener("abort", onAbort, { once: true });

        void locallyAvailable.then((available) => {
          if (settled || signal.aborted) {
            return;
          }
          if (!available && !allowBrowserService) {
            finish(
              new Error(
                `No installed on-device ${language === "ar-JO" ? "Arabic" : "English"} speech model is available. Enable the clearly labeled browser speech option to allow that browser's speech service, or type instead.`,
              ),
            );
            return;
          }
          if (!available && "processLocally" in recognition) {
            recognition.processLocally = false;
          }
          try {
            recognition.start();
          } catch {
            finish(
              new Error("Could not start on-device microphone recognition."),
            );
          }
        });
      });
    },
    cancel() {
      activeAbort?.();
      activeRecognition?.abort();
      activeRecognition = undefined;
      activeAbort = undefined;
    },
  };
}

function abortError() {
  return new DOMException("Speech recognition cancelled", "AbortError");
}
