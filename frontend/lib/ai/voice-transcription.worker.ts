import {
  env,
  LogLevel,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

const modelId = "onnx-community/whisper-tiny";

type TranscriptionRequest = {
  type: "transcribe";
  id: number;
  audio: Float32Array;
};

type TranscriptionResponse =
  | { type: "progress"; id: number; percent?: number }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; message: string };

const workerScope = self;
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.logLevel = LogLevel.ERROR;

let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let loading: Promise<AutomaticSpeechRecognitionPipeline> | undefined;
let activeId: number | undefined;

async function getTranscriber(id: number) {
  if (transcriber) return transcriber;
  loading ??= pipeline("automatic-speech-recognition", modelId, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (progress) => {
      if (progress.status === "progress_total") {
        workerScope.postMessage({
          type: "progress",
          id,
          percent: progress.progress,
        } satisfies TranscriptionResponse);
      }
    },
  });
  try {
    transcriber = await loading;
    return transcriber;
  } finally {
    loading = undefined;
  }
}

workerScope.addEventListener("message", async (event: MessageEvent<TranscriptionRequest>) => {
  const request = event.data;
  if (request.type !== "transcribe" || activeId !== undefined) return;
  activeId = request.id;
  try {
    const model = await getTranscriber(request.id);
    if (activeId !== request.id) return;
    const result = await model(request.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    if (activeId !== request.id) return;
    workerScope.postMessage({
      type: "result",
      id: request.id,
      text: result.text.trim(),
    } satisfies TranscriptionResponse);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: error instanceof Error
        ? `On-device captions failed: ${error.message}`
        : "On-device captions failed. You can still add a caption manually.",
    } satisfies TranscriptionResponse);
  } finally {
    if (activeId === request.id) activeId = undefined;
  }
});
