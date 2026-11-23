/**
 * OpenAI-compatible chat completions client.
 * Mock is the default whenever the API key or base URL is missing.
 * The key is sent only as a bearer token and is never written to logs here.
 */

import { mockCompletion, openAiTools, type AgentMessage } from "./agent-control.js";

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_INPUT_TOKENS = 6_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 800;

export type ModelMode = "mock" | "real";

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelCompletion = {
  content: string | null;
  toolCalls: ModelToolCall[];
  mode: ModelMode;
  estimatedInputTokens: number;
};

export type ModelClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
};

const retryable = new Set([408, 429, 500, 502, 503, 504]);

export function resolveModelMode(config: { apiKey?: string; baseUrl?: string }): ModelMode {
  if (config.apiKey && config.baseUrl) return "real";
  return "mock";
}

export function estimateTokens(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(text.length / 4));
}

export function applyTokenBudget(
  messages: AgentMessage[],
  budget = DEFAULT_MAX_INPUT_TOKENS,
): { messages: AgentMessage[]; estimated: number; truncated: boolean } {
  const system = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  let chosen = [...system, ...rest];
  let truncated = false;
  while (estimateTokens(chosen) > budget && rest.length > 1) {
    rest.shift();
    chosen = [...system, ...rest];
    truncated = true;
  }
  const estimated = estimateTokens(chosen);
  if (estimated > budget) {
    throw new Error("The prompt is over the token budget.");
  }
  return { messages: chosen, estimated, truncated };
}

export function chatCompletionsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") {
    throw new Error("SOPHIA_MODEL_BASE_URL must be https.");
  }
  if (url.username || url.password) {
    throw new Error("SOPHIA_MODEL_BASE_URL must not include credentials.");
  }
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = `${path}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function completeChat(input: {
  messages: AgentMessage[];
  config?: ModelClientConfig;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  tools?: ReturnType<typeof openAiTools>;
}): Promise<ModelCompletion> {
  const config = input.config ?? {};
  const mode = resolveModelMode(config);
  const budgeted = applyTokenBudget(input.messages, config.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS);
  if (mode === "mock") {
    const completion = mockCompletion(budgeted.messages);
    if (completion.content) input.onDelta?.(completion.content);
    return {
      content: completion.content,
      toolCalls: completion.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
      mode,
      estimatedInputTokens: budgeted.estimated,
    };
  }
  const real = await completeReal({
    messages: budgeted.messages,
    tools: input.tools ?? openAiTools(),
    config,
    signal: input.signal,
    onDelta: input.onDelta,
  });
  return { ...real, mode, estimatedInputTokens: budgeted.estimated };
}

async function completeReal(input: {
  messages: AgentMessage[];
  tools: ReturnType<typeof openAiTools>;
  config: ModelClientConfig;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<Omit<ModelCompletion, "mode" | "estimatedInputTokens">> {
  const fetchImpl = input.config.fetchImpl ?? fetch;
  const sleep = input.config.sleep ?? delay;
  const timeoutMs = input.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = input.config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const url = chatCompletionsUrl(input.config.baseUrl!);
  const body = {
    model: input.config.model || "grok-4.7",
    temperature: 0.2,
    max_tokens: input.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages: input.messages,
    tools: input.tools,
    stream: true,
  };
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw abortError();
    const deadline = linkedTimeout(timeoutMs, input.signal);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "text/event-stream, application/json",
          Authorization: `Bearer ${input.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: deadline.signal,
      });
      if (!response.ok) {
        if (retryable.has(response.status) && attempt < maxAttempts - 1) {
          await sleep(200 * 2 ** attempt);
          continue;
        }
        throw new ModelStatusError(response.status);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        return await readEventStream(response.body, input.onDelta);
      }
      const payload = await response.json();
      return readCompletion(payload, input.onDelta);
    } catch (error) {
      if (error instanceof ModelStatusError) throw error;
      if (input.signal?.aborted || deadline.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error instanceof Error ? error : abortError();
      }
      lastError = error instanceof Error ? error : new Error("Model request failed.");
      if (attempt < maxAttempts - 1) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw lastError;
    } finally {
      deadline.cancel();
    }
  }
  throw lastError ?? new Error("Model request failed.");
}

export function readCompletion(payload: unknown, onDelta?: (text: string) => void): Omit<ModelCompletion, "mode" | "estimatedInputTokens"> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Model response was empty.");
  }
  const choice = (payload as { choices?: unknown[] }).choices?.[0];
  if (!choice || typeof choice !== "object") throw new Error("Model response had no choice.");
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== "object") throw new Error("Model response had no message.");
  const content = (message as { content?: unknown }).content;
  const text = typeof content === "string" && content.trim() ? content.trim() : null;
  if (text) onDelta?.(text);
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  return { content: text, toolCalls: readToolCalls(calls) };
}

export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (text: string) => void,
): Promise<Omit<ModelCompletion, "mode" | "estimatedInputTokens">> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: unknown;
      try {
        json = JSON.parse(data) as unknown;
      } catch {
        continue;
      }
      absorbDelta(json, calls, (piece) => {
        content += piece;
        onDelta?.(piece);
      });
    }
  }
  const toolCalls = [...calls.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, call]) => ({
      id: call.id || `call-${call.name}`,
      name: call.name,
      arguments: parseArguments(call.arguments),
    }))
    .filter((call) => call.name);
  return { content: content.trim() || null, toolCalls };
}

function absorbDelta(
  payload: unknown,
  calls: Map<number, { id: string; name: string; arguments: string }>,
  onText: (piece: string) => void,
) {
  if (!payload || typeof payload !== "object") return;
  const choice = (payload as { choices?: unknown[] }).choices?.[0];
  if (!choice || typeof choice !== "object") return;
  const delta = (choice as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return;
  const text = (delta as { content?: unknown }).content;
  if (typeof text === "string" && text) onText(text);
  const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls)) return;
  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const index = typeof (call as { index?: unknown }).index === "number"
      ? (call as { index: number }).index
      : 0;
    const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
    const id = (call as { id?: unknown }).id;
    if (typeof id === "string" && id) current.id = id;
    const fn = (call as { function?: unknown }).function;
    if (fn && typeof fn === "object") {
      const name = (fn as { name?: unknown }).name;
      const args = (fn as { arguments?: unknown }).arguments;
      if (typeof name === "string") current.name += name;
      if (typeof args === "string") current.arguments += args;
    }
    calls.set(index, current);
  }
}

function readToolCalls(value: unknown): ModelToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ModelToolCall[] = [];
  for (const call of value) {
    if (!call || typeof call !== "object") continue;
    const fn = (call as { function?: unknown }).function;
    if (!fn || typeof fn !== "object") continue;
    const name = (fn as { name?: unknown }).name;
    if (typeof name !== "string" || !name) continue;
    const id = (call as { id?: unknown }).id;
    calls.push({
      id: typeof id === "string" && id ? id : `call-${name}`,
      name,
      arguments: parseArguments((fn as { arguments?: unknown }).arguments),
    });
  }
  return calls;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function linkedTimeout(ms: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(abortError()), ms);
  const onParent = () => {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(parent?.reason ?? abortError());
  };
  if (parent?.aborted) onParent();
  else parent?.addEventListener("abort", onParent, { once: true });
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

function abortError() {
  const error = new Error("The model request was aborted.");
  error.name = "AbortError";
  return error;
}

export class ModelStatusError extends Error {
  constructor(readonly status: number) {
    super(`Model request failed with status ${status}.`);
    this.name = "ModelStatusError";
  }
}

export function publicModelProviderFailure(error: unknown) {
  if (!(error instanceof ModelStatusError)) {
    return {
      error: "Sophia could not connect to the configured model provider. Check the backend provider settings and network access.",
      code: "agent_provider_unreachable",
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      error: "The model provider rejected Sophia's API key. Check SOPHIA_MODEL_API_KEY in the backend deployment settings.",
      code: "agent_provider_auth_error",
    };
  }
  if (error.status === 404) {
    return {
      error: "The configured Grok model or API endpoint was not found. Check SOPHIA_MODEL_NAME and SOPHIA_MODEL_BASE_URL.",
      code: "agent_model_not_found",
    };
  }
  if (error.status === 429) {
    return {
      error: "The model provider rate limit or API quota was reached. Check the xAI account limits and billing.",
      code: "agent_provider_rate_limited",
    };
  }
  if (error.status >= 500) {
    return {
      error: "The model provider is temporarily unavailable. Please try again shortly.",
      code: "agent_provider_unavailable",
    };
  }
  return {
    error: "The model provider rejected Sophia's request. Check the backend model configuration.",
    code: "agent_provider_error",
  };
}
