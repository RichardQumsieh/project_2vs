import type {
  ChatTurn,
  InferenceProgress,
  LocalInferenceProvider,
} from "./types";

type WorkerRequest = {
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
  | {
      type: "progress";
      id: number;
      phase: "loading" | "generating";
      percent?: number;
    }
  | {
      type: "result";
      id: number;
      text: string;
    }
  | {
      type: "chunk";
      id: number;
      text: string;
    }
  | {
      type: "reset";
      id: number;
    }
  | {
      type: "error";
      id: number;
      message?: string;
    };

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: InferenceProgress) => void;
  onChunk?: (chunk: string) => void;
  onReset?: () => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, PendingRequest>();

function abortError() {
  return new DOMException("Local inference cancelled", "AbortError");
}

function rejectAll(error: Error) {
  for (const request of pending.values()) {
    if (request.abortHandler) {
      request.signal?.removeEventListener(
        "abort",
        request.abortHandler,
      );
    }
    request.reject(error);
  }

  pending.clear();
}

function stopWorker(error: Error) {
  worker?.terminate();
  worker = undefined;
  rejectAll(error);
}

export function resetLocalInferenceProvider() {
  stopWorker(abortError());
}

function ensureWorker() {
  if (worker) {
    return worker;
  }

  const instance = new Worker(
    new URL("./inference.worker.ts", import.meta.url),
    { type: "module" },
  );

  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);

    if (!request) {
      return;
    }

    if (response.type === "progress") {
      request.onProgress?.({
        phase: response.phase,
        percent: response.percent,
      });
      return;
    }

    if (response.type === "chunk") {
      request.onChunk?.(response.text);
      return;
    }

    if (response.type === "reset") {
      request.onReset?.();
      return;
    }

    pending.delete(response.id);
    if (request.abortHandler) {
      request.signal?.removeEventListener(
        "abort",
        request.abortHandler,
      );
    }

    if (response.type === "result") {
      request.resolve(response.text);
    } else {
      request.reject(
        new Error(response.message ??
          "The local model could not run. Check browser storage and device capacity, then retry."),
      );
    }
  };

  instance.onerror = () => {
    stopWorker(
      new Error(
        "The local inference worker stopped unexpectedly. Please try again.",
      ),
    );
  };

  worker = instance;
  return instance;
}

export const localInferenceProvider: LocalInferenceProvider = {
  generate(messages, options = {}) {
    if (options.signal?.aborted) {
      return Promise.reject(abortError());
    }

    if (pending.size > 0) {
      return Promise.reject(
        new Error("A local AI task is already running."),
      );
    }

    const id = ++requestId;
    const instance = ensureWorker();

    return new Promise<string>((resolve, reject) => {
      const request: PendingRequest = {
        resolve,
        reject,
        onProgress: options.onProgress,
        onChunk: options.onChunk,
        onReset: options.onReset,
        signal: options.signal,
      };

      request.abortHandler = () => {
        stopWorker(abortError());
      };

      options.signal?.addEventListener(
        "abort",
        request.abortHandler,
        { once: true },
      );
      pending.set(id, request);
      instance.postMessage({
        type: "generate",
        id,
        messages,
        stream: options.stream === true,
        maxNewTokens: options.maxNewTokens ?? 120,
        doSample: options.doSample ?? false,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
      } satisfies WorkerRequest);
    });
  },
};
