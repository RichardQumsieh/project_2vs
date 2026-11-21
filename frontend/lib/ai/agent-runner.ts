"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { resolveApiUrl } from "@/lib/api-url";
import type { Locale } from "@/lib/i18n/locale";
import { createBrowserExecutor, type AgentExecutor } from "./agent-browser";
import {
  mockCompletion,
  runAgentPlan,
  type AgentMessage,
  type AgentModel,
  type AgentStep,
  type Autonomy,
  type ProvenanceSource,
} from "./agent-control";

export type AgentRunnerMode = "live" | "preview";

export function useAgentRunner(options: {
  mode: AgentRunnerMode;
  onLocale?: (locale: Locale) => void;
  loadChatExcerpt?: () => Promise<string | null>;
}) {
  const [command, setCommand] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("full_control");
  const [readChats, setReadChats] = useState(false);
  const [readChatsPurpose, setReadChatsPurpose] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null);
  const writesRef = useRef(false);
  const onLocaleRef = useRef(options.onLocale);
  const loadChatRef = useRef(options.loadChatExcerpt);
  fileRef.current = file;
  writesRef.current = writesEnabled;
  onLocaleRef.current = options.onLocale;
  loadChatRef.current = options.loadChatExcerpt;
  const executorRef = useRef(options.mode === "preview"
    ? previewExecutor()
    : createBrowserExecutor({
        getFile: () => fileRef.current,
        writesEnabled: () => writesRef.current,
        onLocale: (locale) => onLocaleRef.current?.(locale),
      }));
  const executor = executorRef.current;

  useEffect(() => {
    if (options.mode !== "live") {
      setReadChatsPurpose("Allow Sophia to read my chats. Decrypted messages from this signed-in browser can be sent to the model as untrusted data.");
      return;
    }
    let cancelled = false;
    void api.agentStatus().then((status) => {
      if (cancelled) return;
      setAutonomy(status.autonomy);
      setReadChats(status.readChats);
      setReadChatsPurpose(status.readChatsPurpose);
      setStopped(status.halted);
      if (!status.enabled) setNotice("Sophia is switched off for this server.");
    }).catch(() => {
      if (!cancelled) setNotice("");
    });
    void api.integrationWritesStatus().then((status) => {
      if (!cancelled) setWritesEnabled(status.writesEnabled);
    }).catch(() => {
      if (!cancelled) setWritesEnabled(false);
    });
    return () => {
      cancelled = true;
    };
  }, [options.mode]);

  const persist = useCallback(async (nextAutonomy: Autonomy, nextRead: boolean) => {
    setAutonomy(nextAutonomy);
    setReadChats(nextRead);
    if (options.mode !== "live") return;
    try {
      await api.saveAgentSettings({ autonomy: nextAutonomy, readChats: nextRead });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }, [options.mode]);

  const record = useCallback((step: AgentStep) => {
    if (options.mode !== "live") return;
    const result = step.status === "executed"
      ? "ok"
      : step.status === "undone"
        ? "undone"
        : step.status;
    void api.recordAgentActivity({
      tool: step.tool,
      result,
      summary: step.activitySummary,
    }).catch(() => undefined);
  }, [options.mode]);

  const submit = useCallback(async () => {
    const value = command.trim();
    if (!value || running) return;
    setRunning(true);
    setNotice("");
    setText("");
    const controller = new AbortController();
    abortRef.current = controller;
    if (stopped && options.mode === "live") {
      try {
        await api.resumeAgent();
      } catch {
        // The complete call also resumes when the person sends a new command.
      }
      setStopped(false);
    }
    const blocks: Array<{ source: ProvenanceSource; text: string }> = [];
    if (readChats && loadChatRef.current) {
      try {
        const excerpt = await loadChatRef.current();
        if (excerpt?.trim()) blocks.push({ source: "chat", text: excerpt.slice(0, 1_600) });
      } catch {
        blocks.push({ source: "chat", text: "" });
      }
    }
    try {
      const result = await runAgentPlan({
        command: value,
        blocks,
        autonomy,
        agentEnabled: true,
        readChats,
        integrationsWriteEnabled: options.mode === "preview" ? true : writesRef.current,
        model: options.mode === "preview" ? previewModel() : serverModel(),
        execute: (call, ctx) => executor.execute(call, ctx),
        signal: controller.signal,
        onStep: (step) => {
          setSteps((current) => [...current, step]);
          if (step.status !== "confirmed") record(step);
        },
      });
      setText(result.text);
      if (result.withheld.includes("chat")) {
        setNotice("Chat text stayed on this device because reading chats is off.");
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setStopped(true);
        setNotice("Sophia stopped this plan.");
      } else {
        setNotice(error instanceof Error ? error.message : "Sophia could not finish.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [autonomy, command, executor, options, readChats, record, running, stopped]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStopped(true);
    setRunning(false);
    setNotice("Sophia stopped this plan.");
    if (options.mode === "live") void api.stopAgent().catch(() => undefined);
  }, [options.mode]);

  const confirm = useCallback(async (step: AgentStep) => {
    if (!step.call) return;
    const result = await executor.execute(step.call, { autoApproveWrite: writesRef.current });
    const next: AgentStep = {
      ...step,
      status: result.ok ? "executed" : "failed",
      summary: result.summary,
      display: result.display,
    };
    setSteps((current) => current.map((item) => item.id === step.id ? next : item));
    record(next);
  }, [executor, record]);

  const undo = useCallback(async (step: AgentStep) => {
    if (!step.undo) return;
    const result = await executor.applyUndo(step.undo);
    const next: AgentStep = {
      ...step,
      status: "undone",
      summary: result.summary,
      undo: null,
    };
    setSteps((current) => current.map((item) => item.id === step.id ? next : item));
    record({ ...next, activitySummary: `${step.tool} undone` });
  }, [executor, record]);

  return {
    command,
    setCommand,
    autonomy,
    readChats,
    readChatsPurpose,
    steps,
    text,
    running,
    stopped,
    notice,
    file,
    setFile,
    writesEnabled,
    setAutonomy: (value: Autonomy) => void persist(value, readChats),
    setReadChats: (value: boolean) => void persist(autonomy, value),
    submit,
    stop,
    confirm,
    undo,
  };
}

function previewModel(): AgentModel {
  return {
    async complete({ messages, onDelta }) {
      const completion = mockCompletion(messages as AgentMessage[]);
      if (completion.content) onDelta?.(completion.content);
      return completion;
    },
  };
}

function serverModel(): AgentModel {
  return {
    async complete({ messages, signal, onDelta }) {
      const response = await fetch(`${resolveApiUrl()}/sophia/agent/complete`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ messages, stream: true, resume: true }),
        signal,
      });
      if (!response.ok || !response.body) {
        let message = "Sophia could not answer.";
        try {
          const body = await response.json() as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // The status is enough.
        }
        const error = new Error(message);
        if (response.status === 409) error.name = "AbortError";
        throw error;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content: string | null = null;
      let toolCalls: Array<{ id: string; name: string; arguments: unknown }> = [];
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
          if (!data) continue;
          const json = JSON.parse(data) as {
            text?: string;
            content?: string | null;
            toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
            error?: string;
          };
          if (event === "delta" && json.text) onDelta?.(json.text);
          if (event === "error") throw new Error(json.error || "Sophia could not answer.");
          if (event === "done") {
            content = json.content ?? null;
            toolCalls = json.toolCalls ?? [];
          }
        }
      }
      return { content, toolCalls };
    },
  };
}

function previewExecutor(): AgentExecutor {
  let title = "Family";
  return {
    async execute(call: { name: string; args: Record<string, unknown> }, _ctx?: { autoApproveWrite: boolean }) {
      if (call.name === "chat_rename") {
        const before = title;
        title = String(call.args.title || "Sunday");
        return { ok: true, summary: `Renamed the group to ${title}.`, before: { title: before } };
      }
      if (call.name === "chat_send") {
        return {
          ok: true,
          summary: "Encrypted and sent a message from this device.",
          output: { messageId: "preview-message", deleteSupported: true },
        };
      }
      if (call.name === "safety_numbers_status" || call.name === "safety_numbers_mark_verified") {
        return { ok: true, summary: "Stored safety review is unseen. Sophia cannot mark it verified." };
      }
      return { ok: true, summary: `Finished ${call.name.replaceAll("_", " ")}.` };
    },
    async applyUndo(action: { kind: string; args?: Record<string, unknown>; name?: string }) {
      if (action.kind === "delete_for_everyone") {
        return { ok: true, summary: "Deleted that message for everyone in the chat." };
      }
      if (action.kind === "tool" && action.name === "chat_rename") {
        title = String(action.args?.title || "Family");
        return { ok: true, summary: `Restored the name ${title}.` };
      }
      return { ok: true, summary: "Undone." };
    },
  };
}
