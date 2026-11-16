import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "./types";

type GenerateRequest = {
  type: "generate";
  id: number;
  messages: ChatTurn[];
  stream: boolean;
  maxNewTokens: number;
  doSample: boolean;
  temperature: number;
  topP: number;
};

type WorkerResponse =
  | { type: "result" | "chunk"; id: number; text?: string }
  | { type: "reset"; id: number }
  | { type: "error"; id: number; message?: string };

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: GenerateRequest | null = null;
  terminated = false;

  postMessage(message: GenerateRequest) {
    this.request = message;
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: WorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
}

const workers: FakeWorker[] = [];

async function getProvider() {
  vi.resetModules();
  workers.length = 0;
  vi.stubGlobal(
    "Worker",
    class extends FakeWorker {
      constructor() {
        super();
        workers.push(this);
      }
    },
  );
  const { localInferenceProvider, resetLocalInferenceProvider } =
    await import("./local-provider");
  return { provider: localInferenceProvider, reset: resetLocalInferenceProvider };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local inference worker boundary", () => {
  it("sends the selected prompt to the local worker, not a network request", async () => {
    const { provider } = await getProvider();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const messages: ChatTurn[] = [
      { role: "system", content: "Summarize locally." },
      { role: "user", content: "Selected conversation text." },
    ];
    const result = provider.generate(messages);
    const worker = workers[0]!;

    expect(worker.request?.messages).toEqual(messages);
    expect(fetchSpy).not.toHaveBeenCalled();
    worker.respond({
      type: "result",
      id: worker.request!.id,
      text: "Local summary",
    });

    await expect(result).resolves.toBe("Local summary");
    fetchSpy.mockRestore();
  });

  it("terminates local inference when the caller cancels", async () => {
    const { provider } = await getProvider();
    const controller = new AbortController();
    const result = provider.generate(
      [{ role: "user", content: "Private transcript" }],
      { signal: controller.signal },
    );
    const worker = workers[0]!;

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("reports worker failures without returning a success-shaped response", async () => {
    const { provider } = await getProvider();
    const result = provider.generate([
      { role: "user", content: "Private transcript" },
    ]);
    const worker = workers[0]!;

    worker.respond({
      type: "error",
      id: worker.request!.id,
    });

    await expect(result).rejects.toThrow("local model could not run");
  });

  it("forwards local generation chunks and generation limits", async () => {
    const { provider } = await getProvider();
    const chunks: string[] = [];
    const result = provider.generate(
      [{ role: "user", content: "Continue our private dialogue." }],
      {
        stream: true,
        maxNewTokens: 256,
        onChunk: (chunk) => chunks.push(chunk),
      },
    );
    const worker = workers[0]!;

    expect(worker.request).toMatchObject({
      stream: true,
      maxNewTokens: 256,
      doSample: false,
      temperature: 0.7,
      topP: 0.9,
    });
    worker.respond({
      type: "chunk",
      id: worker.request!.id,
      text: "A thought",
    });
    worker.respond({
      type: "result",
      id: worker.request!.id,
      text: "A thoughtful response.",
    });

    expect(chunks).toEqual(["A thought"]);
    await expect(result).resolves.toBe("A thoughtful response.");
  });

  it("forwards worker stream resets after device fallback", async () => {
    const { provider } = await getProvider();
    const onReset = vi.fn();
    const result = provider.generate(
      [{ role: "user", content: "Private conversation" }],
      { stream: true, onReset },
    );
    const worker = workers[0]!;

    worker.respond({ type: "reset", id: worker.request!.id });
    expect(onReset).toHaveBeenCalledOnce();
    worker.respond({
      type: "result",
      id: worker.request!.id,
      text: "Recovered on CPU.",
    });
    await expect(result).resolves.toBe("Recovered on CPU.");
  });

  it("resets a failed worker before an explicit retry and accepts a fresh request", async () => {
    const { provider, reset } = await getProvider();
    const failed = provider.generate([
      { role: "user", content: "Private prompt" },
    ]);
    const firstWorker = workers[0]!;
    firstWorker.respond({
      type: "error",
      id: firstWorker.request!.id,
      message: "CPU fallback failed",
    });
    await expect(failed).rejects.toThrow("CPU fallback failed");

    reset();
    const retried = provider.generate([
      { role: "user", content: "Private prompt" },
    ]);
    expect(firstWorker.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[1]!.respond({
      type: "result",
      id: workers[1]!.request!.id,
      text: "Recovered.",
    });
    await expect(retried).resolves.toBe("Recovered.");
  });
});
