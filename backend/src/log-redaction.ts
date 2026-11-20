import type { FastifyServerOptions } from "fastify";
import type { LogFn, LoggerOptions } from "pino";

/**
 * Server logs must not contain decrypted chat, ciphertext, prompts, cookies,
 * or tokens. Handlers should still log only static messages and ids. This
 * sanitizer is the backstop when a log call is handed a request or a body.
 */

const maxDepth = 8;
const maxCollectedStrings = 32;
const minScrubLength = 12;

type RequestLike = {
  method?: unknown;
  url?: unknown;
  ip?: unknown;
  body?: unknown;
  headers?: unknown;
  socket?: { remotePort?: number };
  raw?: unknown;
};

export function serializeRequestForLog(request: RequestLike) {
  const url = typeof request.url === "string" ? request.url.split("?")[0] : undefined;
  return {
    method: typeof request.method === "string" ? request.method : undefined,
    url,
    remoteAddress: typeof request.ip === "string" ? request.ip : undefined,
    remotePort: request.socket?.remotePort,
  };
}

export function serializeReplyForLog(reply: { statusCode?: unknown }) {
  return {
    statusCode: typeof reply.statusCode === "number" ? reply.statusCode : undefined,
  };
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return (
    normalized === "text" ||
    normalized === "body" ||
    normalized === "content" ||
    normalized === "prompt" ||
    normalized === "messages" ||
    normalized === "transcript" ||
    normalized === "headers" ||
    normalized === "cookie" ||
    normalized === "setcookie" ||
    normalized === "authorization" ||
    normalized === "query" ||
    normalized.includes("plaintext") ||
    normalized.includes("ciphertext") ||
    normalized === "payload" ||
    normalized.includes("keypackage") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("recoverycode") ||
    normalized.includes("privatekey") ||
    normalized.includes("apikey")
  );
}

function isHttpRequest(value: object): value is RequestLike {
  const record = value as RequestLike;
  return typeof record.method === "string" && (
    record.headers !== undefined ||
    record.socket !== undefined ||
    record.raw !== undefined
  );
}

function isHttpReply(value: object) {
  const record = value as { statusCode?: unknown; getHeader?: unknown; request?: unknown; raw?: unknown };
  return typeof record.statusCode === "number" && (
    typeof record.getHeader === "function" ||
    record.request !== undefined ||
    record.raw !== undefined
  );
}

function addSecret(secrets: Set<string>, value: string) {
  if (secrets.size >= maxCollectedStrings) return;
  if (value.length < minScrubLength || value.length > 16_000) return;
  secrets.add(value);
}

function collectStrings(value: unknown, secrets: Set<string>, depth: number) {
  if (secrets.size >= maxCollectedStrings || depth > maxDepth) return;
  if (typeof value === "string") {
    addSecret(secrets, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectStrings(item, secrets, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value as Record<string, unknown>).slice(0, 20)) {
    collectStrings(child, secrets, depth + 1);
  }
}

function headerValue(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") return undefined;
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function collectFromRequest(request: RequestLike, secrets: Set<string>) {
  collectStrings(request.body, secrets, 0);
  if (typeof request.url === "string") {
    const query = request.url.split("?")[1];
    if (query) addSecret(secrets, query);
  }
  addSecret(secrets, headerValue(request.headers, "cookie") ?? "");
  addSecret(secrets, headerValue(request.headers, "authorization") ?? "");
}

function collectSensitive(value: unknown, secrets: Set<string>, depth: number, seen: WeakSet<object>) {
  if (secrets.size >= maxCollectedStrings || depth > maxDepth || !value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Error) {
    addSecret(secrets, value.message);
    return;
  }
  if (isHttpRequest(value)) {
    collectFromRequest(value, secrets);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectSensitive(item, secrets, depth + 1, seen);
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      collectStrings(child, secrets, 0);
      continue;
    }
    collectSensitive(child, secrets, depth + 1, seen);
  }
}

export function scrubText(input: string, secrets: Set<string>) {
  let out = input;
  for (const secret of secrets) {
    if (secret.length >= minScrubLength && out.includes(secret)) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^:\s/"]+:[^@\s/"]+@/gi, "$1[redacted]@")
    .replace(/\b(bearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[redacted]");
}

function redactValue(value: unknown, secrets: Set<string>, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubText(value, secrets);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (value instanceof Error) {
    seen.add(value);
    const copy = new Error(scrubText(value.message, secrets));
    copy.name = value.name;
    if (value.stack) copy.stack = scrubText(value.stack, secrets);
    return copy;
  }
  if (isHttpRequest(value)) return serializeRequestForLog(value);
  if (isHttpReply(value)) return serializeReplyForLog(value as { statusCode?: unknown });
  if (depth > maxDepth) return "[redacted]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => redactValue(item, secrets, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(child, secrets, depth + 1, seen);
  }
  return output;
}

export function sanitizeLogArgs(args: unknown[]) {
  const secrets = new Set<string>();
  for (const arg of args) collectSensitive(arg, secrets, 0, new WeakSet());
  return args.map((arg) =>
    typeof arg === "string" ? scrubText(arg, secrets) : redactValue(arg, secrets, 0, new WeakSet()),
  );
}

type LoggerConfig = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean> & LoggerOptions;

export function createLoggerOptions(): LoggerConfig {
  const options: LoggerOptions = {
    level: "info",
    serializers: {
      req: serializeRequestForLog,
      res: serializeReplyForLog,
    },
    hooks: {
      logMethod(args, method) {
        try {
          method.apply(this, sanitizeLogArgs(args) as Parameters<LogFn>);
        } catch {
          method.call(this, "log sanitizer failed");
        }
      },
    },
  };
  return options as LoggerConfig;
}
