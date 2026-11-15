import { describe, expect, it, vi } from "vitest";
import {
  canSpeakAutomatically,
  chooseSpeechVoice,
  createBrowserSpeechProvider,
  createIncomingSpeechTracker,
  createSpeechQueue,
  isSafeForAutomaticSpeech,
  isSafeSpeechText,
  isAllowedAutomaticSpeechText,
  speechLanguage,
  type SpeechRequest,
  type TextToSpeechProvider,
} from "./voice-companion";

function message(id: string, plaintext: string, fromMe = false) {
  return {
    id,
    conversationId: "conversation-a",
    senderDeviceId: "device-a",
    fromMe,
    plaintext,
    createdAt: `2026-10-23T16:00:${id.padStart(2, "0")}Z`,
  };
}

const speechRequest: SpeechRequest = {
  text: "Sounds good!",
  language: "en",
  voiceURI: "",
  rate: 1,
};

describe("voice companion preferences and local voice selection", () => {
  it("selects a local voice for the suggestion language and never a remote voice", () => {
    const voices = [
      {
        voiceURI: "remote-en",
        name: "Online English",
        lang: "en-US",
        default: true,
        localService: false,
      },
      {
        voiceURI: "local-en",
        name: "English",
        lang: "en-GB",
        default: false,
        localService: true,
      },
      {
        voiceURI: "local-ar",
        name: "Arabic",
        lang: "ar-JO",
        default: false,
        localService: true,
      },
    ];

    expect(chooseSpeechVoice(voices, "ar")?.voiceURI).toBe("local-ar");
    expect(chooseSpeechVoice(voices, "en", "remote-en")?.voiceURI).toBe("local-en");
    expect(chooseSpeechVoice([voices[0]!], "en")).toBeUndefined();
    expect(
      chooseSpeechVoice([voices[1]!], "ar"),
    ).toBeUndefined();
    expect(speechLanguage("خلينا نحكي tomorrow")).toBe("ar");
    expect(speechLanguage("Let's talk tomorrow")).toBe("en");
  });

  it("assigns the native SpeechSynthesisVoice object to the utterance", async () => {
    const nativeVoice = {
      voiceURI: "local-en",
      name: "English",
      lang: "en-US",
      default: true,
      localService: true,
    } as SpeechSynthesisVoice;
    let assignedVoice: SpeechSynthesisVoice | null = null;
    const synthesis = {
      speaking: false,
      pending: false,
      getVoices: () => [nativeVoice],
      cancel: vi.fn(),
      speak: (utterance: SpeechSynthesisUtterance) => {
        assignedVoice = utterance.voice;
        utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
      },
    } as unknown as SpeechSynthesis;
    class FakeUtterance {
      lang = "";
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror:
        | ((event: SpeechSynthesisErrorEvent) => void)
        | null = null;

      constructor(readonly text: string) {}
    }
    const provider = createBrowserSpeechProvider(
      synthesis,
      FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
    );

    await expect(
      provider.speak(speechRequest, new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(assignedVoice).toBe(nativeVoice);
  });
});

describe("automatic voice privacy and eligibility", () => {
  it.each([
    "Are you free tonight?",
    "What time works for you?",
  ])("allows routine message context: %s", (text) => {
    expect(isSafeForAutomaticSpeech([message("1", text)])).toBe(true);
  });

  it.each([
    "I need help with my password",
    "My doctor changed my medication",
    "I feel like hurting myself",
    "رمز التحقق وصلني",
    "عنوان بيتي هو شارع الملكة",
    "Call me at +1 555 555 0101",
  ])("blocks potentially sensitive context: %s", (text) => {
    expect(isSafeForAutomaticSpeech([message("1", text)])).toBe(false);
  });

  it("requires automatic mode, an unmuted active tab, no competing audio, and safe context", () => {
    const messages = [message("1", "Are you free for coffee?")];
    const options = {
      mode: "automatic" as const,
      muted: false,
      visible: true,
      otherAudioPlaying: false,
      messages,
    };
    expect(canSpeakAutomatically(options)).toBe(true);
    expect(canSpeakAutomatically({ ...options, mode: "selected" })).toBe(false);
    expect(canSpeakAutomatically({ ...options, muted: true })).toBe(false);
    expect(canSpeakAutomatically({ ...options, visible: false })).toBe(false);
    expect(canSpeakAutomatically({ ...options, otherAudioPlaying: true })).toBe(false);
    expect(
      canSpeakAutomatically({
        ...options,
        messages: [message("1", "My password is compromised")],
      }),
    ).toBe(false);
  });

  it("does not read outgoing or unrelated conversation messages automatically", () => {
    expect(isSafeForAutomaticSpeech([message("1", "hello", true)])).toBe(false);
    expect(
      isSafeForAutomaticSpeech([
        { ...message("1", "password reset", false), conversationId: "conversation-b" },
        message("2", "hello"),
      ]),
    ).toBe(true);
    expect(isSafeSpeechText("Your password is compromised")).toBe(false);
    expect(isAllowedAutomaticSpeechText("Sounds good!")).toBe(true);
    expect(isAllowedAutomaticSpeechText("I got some difficult news")).toBe(false);
  });
});

describe("speech queue lifecycle", () => {
  it("never auto-speaks history on open, but allows a newly arrived message", () => {
    const tracker = createIncomingSpeechTracker();
    tracker.observe("conversation-a", "old-message");
    expect(tracker.isEligible("conversation-a", "old-message")).toBe(false);

    tracker.observe("conversation-a", "new-message");
    expect(tracker.isEligible("conversation-a", "new-message")).toBe(true);
    expect(tracker.isEligible("conversation-a", "old-message")).toBe(false);

    tracker.observe("conversation-b", "another-conversation-message");
    expect(
      tracker.isEligible("conversation-b", "another-conversation-message"),
    ).toBe(false);
  });

  it("allows replay of a completed suggestion", async () => {
    const provider: TextToSpeechProvider = {
      getVoices: () => [],
      isSpeaking: () => false,
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    };
    const queue = createSpeechQueue(provider);

    expect(queue.isSpeaking()).toBe(false);
    await expect(
      queue.speakOnce("conversation-a:message-1", speechRequest),
    ).resolves.toBe(true);
    expect(queue.isSpeaking()).toBe(false);
    await expect(
      queue.speakOnce("conversation-a:message-1", speechRequest),
    ).resolves.toBe(true);
    expect(provider.speak).toHaveBeenCalledTimes(2);
  });

  it("allows repeated manual playback of the same suggestion text", async () => {
    const provider: TextToSpeechProvider = {
      getVoices: () => [],
      isSpeaking: () => false,
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    };
    const queue = createSpeechQueue(provider);

    for (const attempt of [1, 2, 3, 4]) {
      await expect(
        queue.speakOnce(
          `selected:conversation-a:message-1:0:${attempt}`,
          speechRequest,
        ),
      ).resolves.toBe(true);
    }

    expect(provider.speak).toHaveBeenCalledTimes(4);
  });

  it("cancels stale speech when a new conversation becomes active", async () => {
    let resolveSpeech!: () => void;
    let callCount = 0;
    const provider: TextToSpeechProvider = {
      getVoices: () => [],
      isSpeaking: () => false,
      speak: vi.fn(
        (_request, signal) =>
          ++callCount === 1
            ? new Promise<void>((resolve, reject) => {
                resolveSpeech = resolve;
                signal.addEventListener(
                  "abort",
                  () => reject(new DOMException("cancelled", "AbortError")),
                  { once: true },
                );
              })
            : Promise.resolve(),
      ),
      cancel: vi.fn(),
    };
    const queue = createSpeechQueue(provider);
    const oldSpeech = queue.speakOnce("conversation-a:message-1", speechRequest);
    expect(queue.isSpeaking()).toBe(true);

    queue.cancel();
    expect(queue.isSpeaking()).toBe(false);
    resolveSpeech();

    await expect(oldSpeech).resolves.toBe(false);
    expect(provider.cancel).toHaveBeenCalledOnce();
    await expect(
      queue.speakOnce("conversation-b:message-1", speechRequest),
    ).resolves.toBe(true);
  });

  it("clears a stuck browser utterance and reports the failure", async () => {
    vi.useFakeTimers();
    const nativeVoice = {
      voiceURI: "local-en",
      name: "English",
      lang: "en-US",
      default: true,
      localService: true,
    } as SpeechSynthesisVoice;
    const synthesis = {
      speaking: false,
      pending: false,
      getVoices: () => [nativeVoice],
      cancel: vi.fn(),
      speak: vi.fn(),
    } as unknown as SpeechSynthesis;
    class FakeUtterance {
      lang = "";
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror:
        | ((event: SpeechSynthesisErrorEvent) => void)
        | null = null;

      constructor(readonly text: string) {}
    }
    const provider = createBrowserSpeechProvider(
      synthesis,
      FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
    );
    const speech = provider.speak(speechRequest, new AbortController().signal);
    const failure = expect(speech).rejects.toThrow("Speech did not finish");
    await vi.advanceTimersByTimeAsync(8_000);
    await failure;

    expect(synthesis.cancel).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
