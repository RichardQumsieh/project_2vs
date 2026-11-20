import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import test from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { authRateLimits } from "../src/auth-rate-limit.js";
import { createLoggerOptions } from "../src/log-redaction.js";
import { sendMessageSchema } from "../src/schemas.js";
import {
  apiSecurityHeaders,
  assertProductionCookieSecure,
  authCookieOptions,
  hstsHeaderValue,
  parseTrustProxy,
} from "../src/security-config.js";

const canary = "decrypted-chat-plaintext-canary-7f3a91c2";

function captureStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

test("production cookies are Secure, HttpOnly, and SameSite=None only with Secure", () => {
  const local = authCookieOptions(false);
  assert.equal(local.httpOnly, true);
  assert.equal(local.secure, false);
  assert.equal(local.sameSite, "lax");
  assert.equal(local.path, "/");

  const production = authCookieOptions(true);
  assert.equal(production.httpOnly, true);
  assert.equal(production.secure, true);
  assert.equal(production.sameSite, "none");

  assert.throws(
    () => assertProductionCookieSecure("production", false),
    /COOKIE_SECURE must be true/,
  );
  assert.doesNotThrow(() => assertProductionCookieSecure("production", true));
  assert.doesNotThrow(() => assertProductionCookieSecure("development", false));
});

test("trustProxy accepts specific proxies and rejects trust-all", () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("127.0.0.1"), "127.0.0.1");
  assert.equal(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12"), "10.0.0.0/8,172.16.0.0/12");
  assert.throws(() => parseTrustProxy("true"), /Refusing to trust every forwarded address/);
  assert.throws(() => parseTrustProxy("*"), /Refusing to trust every forwarded address/);
  assert.throws(() => parseTrustProxy("not-a-proxy"), /not an IP address or CIDR/);
});

test("HSTS is added only for HTTPS API responses", () => {
  const httpHeaders = apiSecurityHeaders("http");
  assert.equal(httpHeaders["Strict-Transport-Security"], undefined);
  assert.equal(httpHeaders["X-Content-Type-Options"], "nosniff");
  assert.equal(httpHeaders["X-Frame-Options"], "DENY");
  assert.equal(httpHeaders["Content-Security-Policy"], "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  assert.match(httpHeaders["Permissions-Policy"], /camera=\(\)/);

  const httpsHeaders = apiSecurityHeaders("https");
  assert.equal(httpsHeaders["Strict-Transport-Security"], hstsHeaderValue);
});

test("forwarded client IP and protocol are honored only for a configured proxy", async () => {
  const untrusted = Fastify({ trustProxy: parseTrustProxy(undefined) });
  untrusted.addHook("onRequest", async (request, reply) => {
    for (const [name, value] of Object.entries(apiSecurityHeaders(request.protocol))) {
      reply.header(name, value);
    }
  });
  untrusted.get("/whoami", async (request) => ({
    ip: request.ip,
    protocol: request.protocol,
  }));

  const spoofed = await untrusted.inject({
    method: "GET",
    url: "/whoami",
    headers: {
      "x-forwarded-for": "203.0.113.8",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(spoofed.statusCode, 200);
  assert.deepEqual(spoofed.json(), { ip: "127.0.0.1", protocol: "http" });
  assert.equal(spoofed.headers["strict-transport-security"], undefined);
  assert.equal(spoofed.headers["x-content-type-options"], "nosniff");
  await untrusted.close();

  const trusted = Fastify({ trustProxy: parseTrustProxy("127.0.0.1") });
  trusted.addHook("onRequest", async (request, reply) => {
    for (const [name, value] of Object.entries(apiSecurityHeaders(request.protocol))) {
      reply.header(name, value);
    }
  });
  trusted.get("/whoami", async (request) => ({
    ip: request.ip,
    protocol: request.protocol,
  }));
  const forwarded = await trusted.inject({
    method: "GET",
    url: "/whoami",
    headers: {
      "x-forwarded-for": "203.0.113.8",
      "x-forwarded-proto": "https",
    },
  });
  assert.deepEqual(forwarded.json(), { ip: "203.0.113.8", protocol: "https" });
  assert.equal(forwarded.headers["strict-transport-security"], hstsHeaderValue);
  await trusted.close();
});

test("auth routes keep their rate limits and the limiter returns 429", async () => {
  assert.equal(authRateLimits.login.max, 10);
  assert.equal(authRateLimits.register.max, 5);
  assert.equal(authRateLimits.totpConfirm.max, 10);
  assert.equal(authRateLimits.forgotPassword.max, 5);
  assert.equal(authRateLimits.resetPassword.max, 5);
  assert.ok(authRateLimits.logout.max <= 30);

  const app = Fastify();
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.post("/auth/login", { config: { rateLimit: authRateLimits.login } }, async () => ({ ok: true }));
  const statuses: number[] = [];
  for (let attempt = 0; attempt < authRateLimits.login.max + 1; attempt += 1) {
    const response = await app.inject({ method: "POST", url: "/auth/login", payload: {} });
    statuses.push(response.statusCode);
  }
  assert.equal(statuses.filter((status) => status === 200).length, authRateLimits.login.max);
  assert.equal(statuses.at(-1), 429);
  await app.close();
});

test("decrypted chat plaintext does not reach server logs", async () => {
  const { lines, stream } = captureStream();
  const app = Fastify({
    logger: {
      ...createLoggerOptions(),
      stream,
    },
    trustProxy: false,
  });
  app.post("/conversations/:id/messages", async (request) => {
    const body = request.body as {
      plaintext?: string;
      text?: string;
      ciphertext?: string;
    };
    request.log.info(
      {
        accepted: true,
        body,
        plaintext: body.plaintext,
        prompt: body.text,
        ciphertext: body.ciphertext,
        headers: request.headers,
        password: "correct horse battery staple",
      },
      `stored chat ${body.plaintext ?? ""}`,
    );
    request.log.error(
      { err: new Error(`boom ${body.plaintext ?? ""} postgresql://messenger:messenger@postgres/messenger`), body },
      "message failed",
    );
    return { ok: true };
  });

  const response = await app.inject({
    method: "POST",
    url: `/conversations/c/messages?token=${canary}`,
    headers: {
      cookie: `messenger_session=${canary}`,
      authorization: `Bearer ${canary}`,
      "content-type": "application/json",
    },
    payload: {
      plaintext: canary,
      text: canary,
      ciphertext: `ciphertext-blob-${canary}`,
      prompt: canary,
      messages: [{ text: canary }],
    },
  });
  assert.equal(response.statusCode, 200);
  await app.close();

  const output = lines.join("\n");
  assert.ok(output.includes("\"accepted\":true"), output);
  assert.equal(output.includes(canary), false, output);
  assert.equal(output.includes("ciphertext-blob-"), false, output);
  assert.equal(output.includes("messenger_session="), false, output);
  assert.equal(output.includes("correct horse battery staple"), false, output);
  assert.equal(output.includes("messenger:messenger@"), false, output);
  assert.equal(output.includes(`token=${canary}`), false, output);
});

test("group MLS payload and plaintext do not reach server logs", async () => {
  const { lines, stream } = captureStream();
  const app = Fastify({
    logger: { ...createLoggerOptions(), stream },
    trustProxy: false,
  });
  const groupPlain = `group-plaintext-${canary}`;
  const groupPayload = `mls-payload-${canary}`;
  app.post("/conversations/:id/mls", async (request) => {
    const body = request.body as { payload?: string; plaintext?: string };
    request.log.info(
      { accepted: true, payload: body.payload, plaintext: body.plaintext, body },
      `stored group ${body.plaintext ?? ""} ${body.payload ?? ""}`,
    );
    return { ok: true };
  });
  const response = await app.inject({
    method: "POST",
    url: "/conversations/c/mls",
    headers: { "content-type": "application/json" },
    payload: { payload: groupPayload, plaintext: groupPlain },
  });
  assert.equal(response.statusCode, 200);
  await app.close();
  const output = lines.join("\n");
  assert.ok(output.includes("\"accepted\":true"), output);
  assert.equal(output.includes(canary), false, output);
  assert.equal(output.includes("mls-payload-"), false, output);
  assert.equal(output.includes("group-plaintext-"), false, output);
});

test("message submissions cannot carry a decrypted plaintext field", () => {
  const senderDeviceId = "11111111-1111-4111-8111-111111111111";
  const legacy = sendMessageSchema.safeParse({
    senderDeviceId,
    ciphertext: "ciphertext",
    nonce: "nonce",
    ratchetHeader: {},
    plaintext: canary,
  });
  assert.equal(legacy.success, false);

  const envelopes = sendMessageSchema.safeParse({
    senderDeviceId,
    plaintext: canary,
    envelopes: [
      {
        recipientDeviceId: "22222222-2222-4222-8222-222222222222",
        ciphertext: "ciphertext",
        nonce: "nonce",
        ratchetHeader: {
          recipientDeviceId: "22222222-2222-4222-8222-222222222222",
        },
      },
    ],
  });
  assert.equal(envelopes.success, false);
});

test("the API process wires the logger, proxy trust, and auth limits", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../src/routes/auth.ts", import.meta.url), "utf8");
  assert.match(index, /createLoggerOptions\(\)/);
  assert.match(index, /trustProxy/);
  assert.match(index, /apiSecurityHeaders/);
  assert.match(auth, /authRateLimits\.login/);
  assert.match(auth, /authRateLimits\.logout/);
  assert.match(auth, /authRateLimits\.forgotPassword/);
  assert.match(auth, /authRateLimits\.resetPassword/);
  assert.doesNotMatch(index, /logger:\s*true/);
});
