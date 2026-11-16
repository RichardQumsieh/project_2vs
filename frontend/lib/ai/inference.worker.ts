import {
  env,
  LogLevel,
  pipeline,
  TextStreamer,
  type TextGenerationPipeline,
} from "@huggingface/transformers";
import type { ChatTurn, InferenceProgress } from "./types";

const modelId = "onnx-community/Qwen3-0.6B-ONNX";
const modelRevision = "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0";

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

type NavigatorWithGPU = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

type WorkerResponse =
  | {
      type: "progress";
      id: number;
      phase: InferenceProgress["phase"];
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

const workerScope = self;
let generator: TextGenerationPipeline | undefined;
let loading: Promise<TextGenerationPipeline> | undefined;
let activeId: number | undefined;
let activeDevice: "webgpu" | "wasm" = "wasm";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.logLevel = LogLevel.ERROR;

async function getGenerator(
  id: number,
) {
  if (generator) {
    return generator;
  }

  const gpu = (navigator as NavigatorWithGPU).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  activeDevice = adapter ? "webgpu" : "wasm";

  const createPipeline = (device: "webgpu" | "wasm") =>
    pipeline("text-generation", modelId, {
      revision: modelRevision,
      dtype: "q4f16",
      device,
      progress_callback: (progress) => {
        if (progress.status === "progress_total") {
          workerScope.postMessage({
            type: "progress",
            id,
            phase: "loading",
            percent: progress.progress,
          } satisfies WorkerResponse);
        } else if (progress.status === "ready") {
          workerScope.postMessage({
            type: "progress",
            id,
            phase: "generating",
          } satisfies WorkerResponse);
        }
      },
    });

  try {
    loading ??= createPipeline(activeDevice);
    try {
      generator = await loading;
    } catch (error) {
      if (activeDevice !== "webgpu") {
        throw error;
      }
      activeDevice = "wasm";
      loading = createPipeline(activeDevice);
      generator = await loading;
    }
    return generator;
  } finally {
    loading = undefined;
  }
}

async function generate(
  model: TextGenerationPipeline,
  request: GenerateRequest,
) {
  const streamer = request.stream
    ? new TextStreamer(model.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          if (activeId === request.id && text) {
            workerScope.postMessage({
              type: "chunk",
              id: request.id,
              text,
            } satisfies WorkerResponse);
          }
        },
      })
    : undefined;

  workerScope.postMessage({
    type: "progress",
    id: request.id,
    phase: "generating",
  } satisfies WorkerResponse);

  return model(request.messages, {
    max_new_tokens: request.maxNewTokens,
    do_sample: request.doSample,
    temperature: request.temperature,
    top_p: request.topP,
    repetition_penalty: 1.15,
    no_repeat_ngram_size: 4,
    streamer,
    tokenizer_encode_kwargs: {
      enable_thinking: false,
    },
  });
}

workerScope.addEventListener(
  "message",
  async (event: Event) => {
    const request = (event as MessageEvent<GenerateRequest>).data;
    if (request.type !== "generate" || activeId !== undefined) {
      return;
    }

    activeId = request.id;
    try {
      let model = await getGenerator(request.id);
      if (activeId !== request.id) {
        return;
      }
      let result;
      try {
        result = await generate(model, request);
      } catch (error) {
        if (activeDevice !== "webgpu" || activeId !== request.id) {
          throw error;
        }
        await model.dispose();
        generator = undefined;
        activeDevice = "wasm";
        workerScope.postMessage({
          type: "reset",
          id: request.id,
        } satisfies WorkerResponse);
        model = await getGenerator(request.id);
        result = await generate(model, request);
      }

      if (activeId !== request.id) {
        return;
      }

      const generated = result[0]?.generated_text;
      const lastMessage = Array.isArray(generated)
        ? generated.at(-1)
        : undefined;
      const text =
        lastMessage && typeof lastMessage.content === "string"
          ? lastMessage.content
          : "";

      workerScope.postMessage({
        type: "result",
        id: request.id,
        text,
      } satisfies WorkerResponse);
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        id: request.id,
        message: activeDevice === "wasm"
          ? "Local inference failed, including the CPU recovery attempt. Try a shorter prompt, close other tabs, or use a higher-memory device."
          : error instanceof Error
            ? `Local inference failed: ${error.message}`
            : "Local inference failed. Retry, or use a higher-memory device.",
      } satisfies WorkerResponse);
    } finally {
      if (activeId === request.id) {
        activeId = undefined;
      }
    }
  },
);
