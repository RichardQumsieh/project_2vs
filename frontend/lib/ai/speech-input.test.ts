import { describe, expect, it, vi } from "vitest";
import {
  createOnDeviceSpeechInputProvider,
  type SpeechInputLanguage,
} from "./speech-input";

type MockRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: {
    results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};

function recognitionHarness(
  availability: "available" | "downloadable" | "downloading" | "unavailable",
) {
  const instances: MockRecognition[] = [];
  const Recognition = Object.assign(
    class {
      lang = "";
      continuous = false;
      interimResults = false;
      processLocally = false;
      onresult: MockRecognition["onresult"] = null;
      onerror: MockRecognition["onerror"] = null;
      onend: MockRecognition["onend"] = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn(() => this.onend?.());

      constructor() {
        instances.push(this);
      }
    },
    {
      available: vi.fn(async (options: {
        langs: string[];
        processLocally: true;
      }) =>
        options.langs.length > 0 && options.processLocally
          ? availability
          : "unavailable",
      ),
    },
  );
  const browserWindow = {
    SpeechRecognition: Recognition,
  } as unknown as Window;

  return {
    provider: createOnDeviceSpeechInputProvider(browserWindow),
    Recognition,
    instances,
  };
}

describe("on-device speech input", () => {
  it("starts recognition only after explicit listen and verified installed local model", async () => {
    const harness = recognitionHarness("available");
    const language: SpeechInputLanguage = "ar-JO";
    await expect(harness.provider.isOnDeviceAvailable(language)).resolves.toBe(true);

    const interim = vi.fn();
    const controller = new AbortController();
    const result = harness.provider.listen(language, {
      signal: controller.signal,
      onInterim: interim,
    });
    await vi.waitFor(() =>
      expect(harness.instances[0]?.start).toHaveBeenCalledOnce(),
    );
    const recognition = harness.instances[0]!;

    expect(harness.Recognition.available).toHaveBeenCalledWith({
      langs: [language],
      processLocally: true,
    });
    expect(recognition.processLocally).toBe(true);
    expect(recognition.lang).toBe(language);
    expect(recognition.start).toHaveBeenCalledOnce();

    recognition.onresult?.({
      results: [
        { isFinal: false, 0: { transcript: "بكرا" } },
        { isFinal: true, 0: { transcript: "خلينا نحكي" } },
      ],
    });
    expect(interim).toHaveBeenCalledWith("بكرا");
    recognition.onend?.();

    await expect(result).resolves.toBe("خلينا نحكي");
  });

  it("never starts recognition if the local language pack is missing", async () => {
    const harness = recognitionHarness("downloadable");
    const result = harness.provider.listen("en-US", {
      signal: new AbortController().signal,
      onInterim: vi.fn(),
    });

    await expect(result).rejects.toThrow("Enable the clearly labeled browser speech option");
    expect(harness.instances[0]?.start).not.toHaveBeenCalled();
  });

  it("uses browser speech only after the caller explicitly opts in", async () => {
    const harness = recognitionHarness("unavailable");
    const result = harness.provider.listen("en-US", {
      signal: new AbortController().signal,
      onInterim: vi.fn(),
      allowBrowserService: true,
    });
    await vi.waitFor(() =>
      expect(harness.instances[0]?.start).toHaveBeenCalledOnce(),
    );
    expect(harness.instances[0]?.processLocally).toBe(false);
    harness.instances[0]?.onresult?.({
      results: [{ isFinal: true, 0: { transcript: "Hello companion" } }],
    });
    harness.instances[0]?.onend?.();
    await expect(result).resolves.toBe("Hello companion");
  });

  it("cancels a listening request and reports permission denial", async () => {
    const harness = recognitionHarness("available");
    const controller = new AbortController();
    const result = harness.provider.listen("en-US", {
      signal: controller.signal,
      onInterim: vi.fn(),
    });
    await vi.waitFor(() =>
      expect(harness.instances[0]?.start).toHaveBeenCalledOnce(),
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });

    const denied = harness.provider.listen("en-US", {
      signal: new AbortController().signal,
      onInterim: vi.fn(),
    });
    await vi.waitFor(() => expect(harness.instances).toHaveLength(2));
    harness.instances[1]?.onerror?.({ error: "not-allowed" });
    await expect(denied).rejects.toThrow("Microphone permission was denied");
  });

  it("reports unsupported recognition instead of silently using an online API", async () => {
    const provider = createOnDeviceSpeechInputProvider({} as Window);
    await expect(provider.isOnDeviceAvailable("en-US")).resolves.toBe(false);
    await expect(
      provider.listen("en-US", {
        signal: new AbortController().signal,
        onInterim: vi.fn(),
      }),
    ).rejects.toThrow("does not expose speech recognition");
  });
});
