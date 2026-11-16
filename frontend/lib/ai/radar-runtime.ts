import type { LocalMessage } from "../crypto/types";
import { extractRadarFindings } from "./radar-extractor";
import type { RadarFinding } from "./radar-store";

export type RadarRuntimeSettings = {
  enabled: boolean;
  conversationAllowed: boolean;
};

export type RadarRuntimeEvent =
  | { type: "mount" }
  | {
      type: "conversation-selected";
      conversationId: string;
    }
  | {
      type: "messages-loaded";
      conversationId: string;
      messages: LocalMessage[];
    }
  | {
      type: "settings-updated";
      settings: RadarRuntimeSettings;
    }
  | { type: "cancel" }
  | { type: "dispose" };

type RuntimeOptions = {
  debounceMs?: number;
  onFindings: (findings: RadarFinding[]) => void;
};

export type RadarRuntime = {
  dispatch(event: RadarRuntimeEvent): void;
  dispose(): void;
};

const maxRememberedMessages = 400;

export function createRadarRuntime({
  debounceMs = 700,
  onFindings,
}: RuntimeOptions): RadarRuntime {
  let conversationId: string | null = null;
  let settings: RadarRuntimeSettings = {
    enabled: false,
    conversationAllowed: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let pendingMessages: LocalMessage[] = [];
  let latestMessages: LocalMessage[] = [];
  const seenIds = new Set<string>();
  let baselineReady = false;

  function cancelPending() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    pendingMessages = [];
  }

  function clearRemembered() {
    seenIds.clear();
    baselineReady = false;
    latestMessages = [];
  }

  function scheduleScan() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (
        disposed ||
        !settings.enabled ||
        !settings.conversationAllowed ||
        !conversationId ||
        pendingMessages.length === 0
      ) {
        pendingMessages = [];
        return;
      }
      const batch = pendingMessages;
      pendingMessages = [];
      const findings = extractRadarFindings({
        conversationId,
        messages: batch,
      });
      if (findings.length) {
        onFindings(findings);
      }
    }, debounceMs);
  }

  function ingestMessages(
    nextConversationId: string,
    messages: LocalMessage[],
  ) {
    if (disposed || nextConversationId !== conversationId) {
      return;
    }
    const ordered = [...messages].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
    latestMessages = ordered.slice(-maxRememberedMessages);
    if (!baselineReady) {
      for (const message of ordered) {
        seenIds.add(message.id);
      }
      while (seenIds.size > maxRememberedMessages) {
        const first = seenIds.values().next().value;
        if (!first) {
          break;
        }
        seenIds.delete(first);
      }
      baselineReady = true;
      // Initial history scan once after allow + enable, using recent window.
      if (settings.enabled && settings.conversationAllowed) {
        pendingMessages = ordered.slice(-80);
        scheduleScan();
      }
      return;
    }

    const fresh = ordered.filter((message) => !seenIds.has(message.id));
    for (const message of fresh) {
      seenIds.add(message.id);
    }
    while (seenIds.size > maxRememberedMessages) {
      const first = seenIds.values().next().value;
      if (!first) {
        break;
      }
      seenIds.delete(first);
    }
    if (!fresh.length || !settings.enabled || !settings.conversationAllowed) {
      return;
    }
    pendingMessages = [...pendingMessages, ...fresh].slice(-80);
    scheduleScan();
  }

  return {
    dispatch(event) {
      if (disposed) {
        return;
      }
      switch (event.type) {
        case "mount":
          break;
        case "conversation-selected":
          cancelPending();
          clearRemembered();
          conversationId = event.conversationId;
          break;
        case "settings-updated": {
          const wasActive = settings.enabled && settings.conversationAllowed;
          settings = event.settings;
          const isActive = settings.enabled && settings.conversationAllowed;
          if (!isActive) {
            cancelPending();
            break;
          }
          if (!wasActive && conversationId && latestMessages.length) {
            // Re-scan local history when the user newly authorizes analysis.
            seenIds.clear();
            baselineReady = false;
            ingestMessages(conversationId, latestMessages);
          }
          break;
        }
        case "messages-loaded":
          ingestMessages(event.conversationId, event.messages);
          break;
        case "cancel":
          cancelPending();
          break;
        case "dispose":
          disposed = true;
          cancelPending();
          clearRemembered();
          conversationId = null;
          break;
      }
    },
    dispose() {
      disposed = true;
      cancelPending();
      clearRemembered();
      conversationId = null;
    },
  };
}
