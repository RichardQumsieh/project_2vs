export type VoiceTranscriptionProgress = {
  percent?: number;
};

type WorkerResponse =
  | { type: "progress"; id: number; percent?: number }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; message: string };

let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: VoiceTranscriptionProgress) => void;
}>();

function getWorker() {
  if (worker) return worker;
  const instance = new Worker(
    new URL("./voice-transcription.worker.ts", import.meta.url),
    { type: "module" },
  );
  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    if (response.type === "progress") {
      request.onProgress?.({ percent: response.percent });
      return;
    }
    pending.delete(response.id);
    if (response.type === "result") {
      request.resolve(response.text);
    } else {
      request.reject(new Error(response.message));
    }
  };
  instance.onerror = () => {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) {
      request.reject(new Error("The local caption worker stopped unexpectedly."));
    }
    pending.clear();
  };
  worker = instance;
  return instance;
}

export function transcribeVoiceAudio(
  audio: Float32Array,
  onProgress?: (progress: VoiceTranscriptionProgress) => void,
) {
  if (pending.size > 0) {
    return Promise.reject(new Error("A voice caption is already being created."));
  }
  const id = ++requestId;
  const instance = getWorker();
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    instance.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}
