import type { FastifyInstance } from "fastify";
import type { SophiaAutonomy } from "@prisma/client";
import { tryRecordAccountActivity } from "../account-activity-store.js";
import {
  AGENT_SYSTEM_PROMPT,
  READ_CHATS_PURPOSE,
  READ_CHATS_VERSION,
  stripWithheldChats,
  type AgentMessage,
} from "../agent-control.js";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { env, sophiaAgentEnabled } from "../env.js";
import { completeChat } from "../model-provider.js";

const runs = new Map<string, AbortController>();

const roles = new Set(["system", "user", "assistant", "tool"]);

function publicPreference(row: {
  autonomy: SophiaAutonomy;
  readChatsGrantedAt: Date | null;
  haltedAt: Date | null;
} | null) {
  return {
    enabled: sophiaAgentEnabled,
    autonomy: row?.autonomy === "ASK_FIRST" ? "ask_first" as const : "full_control" as const,
    readChats: Boolean(row?.readChatsGrantedAt),
    readChatsPurpose: READ_CHATS_PURPOSE,
    readChatsVersion: READ_CHATS_VERSION,
    halted: Boolean(row?.haltedAt),
    model: env.SOPHIA_MODEL_API_KEY && env.SOPHIA_MODEL_BASE_URL ? "real" as const : "mock" as const,
    experimentalUntil: 0.8,
  };
}

async function loadPreference(userId: string) {
  return prisma.sophiaAgentPreference.findUnique({ where: { userId } });
}

export async function sophiaAgentRoutes(app: FastifyInstance) {
  app.get("/sophia/agent", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const row = await loadPreference(session.sub);
    return publicPreference(row);
  });

  app.put(
    "/sophia/agent/settings",
    { bodyLimit: 4 * 1024, config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      const body = request.body as { autonomy?: unknown; readChats?: unknown } | null;
      if (!body || (body.autonomy !== "full_control" && body.autonomy !== "ask_first") || typeof body.readChats !== "boolean") {
        return reply.code(400).send({ error: "Sophia settings are invalid." });
      }
      const autonomy: SophiaAutonomy = body.autonomy === "ask_first" ? "ASK_FIRST" : "FULL_CONTROL";
      const row = await prisma.sophiaAgentPreference.upsert({
        where: { userId: session.sub },
        create: {
          userId: session.sub,
          autonomy,
          readChatsGrantedAt: body.readChats ? new Date() : null,
          readChatsPurpose: body.readChats ? READ_CHATS_PURPOSE : null,
          readChatsVersion: body.readChats ? READ_CHATS_VERSION : null,
        },
        update: {
          autonomy,
          readChatsGrantedAt: body.readChats ? new Date() : null,
          readChatsPurpose: body.readChats ? READ_CHATS_PURPOSE : null,
          readChatsVersion: body.readChats ? READ_CHATS_VERSION : null,
        },
      });
      await tryRecordAccountActivity({
        ownerUserId: session.sub,
        actorUserId: session.sub,
        actorLabel: session.username,
        action: "SETTING_CHANGED",
        summary: body.readChats
          ? "Allowed Sophia to read chats on this account"
          : `Sophia control set to ${body.autonomy === "ask_first" ? "ask first" : "full control"}`,
        subjectKind: "setting",
        subjectId: "sophia-agent",
      });
      return publicPreference(row);
    },
  );

  app.post("/sophia/agent/stop", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    runs.get(session.sub)?.abort();
    runs.delete(session.sub);
    const row = await prisma.sophiaAgentPreference.upsert({
      where: { userId: session.sub },
      create: { userId: session.sub, haltedAt: new Date() },
      update: { haltedAt: new Date() },
    });
    return publicPreference(row);
  });

  app.post("/sophia/agent/resume", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const row = await prisma.sophiaAgentPreference.upsert({
      where: { userId: session.sub },
      create: { userId: session.sub, haltedAt: null },
      update: { haltedAt: null },
    });
    return publicPreference(row);
  });

  app.post(
    "/sophia/agent/activity",
    { bodyLimit: 2 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      const body = request.body as { tool?: unknown; result?: unknown; summary?: unknown } | null;
      const result = body?.result;
      const allowed = new Set(["ok", "failed", "refused", "confirm", "stopped", "undone"]);
      if (
        !body ||
        typeof body.tool !== "string" ||
        !/^[a-z_]{1,40}$/.test(body.tool) ||
        typeof result !== "string" ||
        !allowed.has(result) ||
        typeof body.summary !== "string"
      ) {
        return reply.code(400).send({ error: "Activity entry is invalid." });
      }
      await tryRecordAccountActivity({
        ownerUserId: session.sub,
        actorUserId: session.sub,
        actorLabel: session.username,
        action: result === "undone" ? "AGENT_UNDONE" : "AGENT_ACTION",
        summary: body.summary,
        subjectKind: "agent",
        subjectId: body.tool,
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/sophia/agent/complete",
    {
      bodyLimit: 48 * 1024,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      if (!sophiaAgentEnabled) {
        return reply.code(503).send({
          error: "Sophia is switched off for this server.",
          code: "agent_disabled",
        });
      }
      const body = request.body as { messages?: unknown; stream?: unknown; resume?: unknown } | null;
      const parsed = parseMessages(body?.messages);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error, code: "agent_invalid" });
      const preference = await loadPreference(session.sub);
      if (preference?.haltedAt && body?.resume !== true) {
        return reply.code(409).send({
          error: "Sophia stopped this plan.",
          code: "agent_stopped",
        });
      }
      if (preference?.haltedAt && body?.resume === true) {
        await prisma.sophiaAgentPreference.update({
          where: { userId: session.sub },
          data: { haltedAt: null },
        });
      }
      const readChats = Boolean(preference?.readChatsGrantedAt);
      const messages: AgentMessage[] = [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        ...stripWithheldChats(
          parsed.messages.filter((message) => message.role !== "system"),
          readChats,
        ),
      ];
      const controller = new AbortController();
      runs.set(session.sub, controller);
      request.raw.on("aborted", () => controller.abort());
      const stream = body?.stream === true;
      try {
        if (!stream) {
          const completion = await completeChat({
            messages,
            config: modelConfig(),
            signal: controller.signal,
          });
          request.log.info(
            { userId: session.sub, mode: completion.mode, tools: completion.toolCalls.map((call) => call.name) },
            "sophia agent complete",
          );
          return {
            content: completion.content,
            toolCalls: completion.toolCalls,
            mode: completion.mode,
            estimatedInputTokens: completion.estimatedInputTokens,
          };
        }
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        const completion = await completeChat({
          messages,
          config: modelConfig(),
          signal: controller.signal,
          onDelta: (text) => writeEvent(reply.raw, "delta", { text }),
        });
        writeEvent(reply.raw, "done", {
          content: completion.content,
          toolCalls: completion.toolCalls,
          mode: completion.mode,
          estimatedInputTokens: completion.estimatedInputTokens,
        });
        reply.raw.end();
        request.log.info(
          { userId: session.sub, mode: completion.mode, tools: completion.toolCalls.map((call) => call.name) },
          "sophia agent complete",
        );
      } catch (error) {
        const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        if (stream) {
          writeEvent(reply.raw, "error", {
            error: aborted ? "Sophia stopped this plan." : "The model could not be reached.",
            code: aborted ? "agent_stopped" : "agent_provider_error",
          });
          reply.raw.end();
          return;
        }
        return reply.code(aborted ? 409 : 502).send({
          error: aborted ? "Sophia stopped this plan." : "The model could not be reached.",
          code: aborted ? "agent_stopped" : "agent_provider_error",
        });
      } finally {
        if (runs.get(session.sub) === controller) runs.delete(session.sub);
      }
    },
  );
}

function modelConfig() {
  return {
    apiKey: env.SOPHIA_MODEL_API_KEY,
    baseUrl: env.SOPHIA_MODEL_BASE_URL,
    model: env.SOPHIA_MODEL_NAME,
  };
}

function parseMessages(value: unknown): { ok: true; messages: AgentMessage[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    return { ok: false, error: "Sophia needs the current conversation with the assistant." };
  }
  const messages: AgentMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "A message was malformed." };
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (typeof role !== "string" || !roles.has(role) || typeof content !== "string") {
      return { ok: false, error: "A message was malformed." };
    }
    if (!content.trim() || content.length > 8_000 || content.includes("\u0000")) {
      return { ok: false, error: "A message was empty or too long." };
    }
    messages.push({ role: role as AgentMessage["role"], content });
  }
  return { ok: true, messages };
}

function writeEvent(raw: NodeJS.WritableStream, event: string, data: unknown) {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
