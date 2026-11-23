import type { LocalMessage } from "../crypto/types";
import type { SummaryLanguage } from "./types";

export type CompanionMode = "quiet" | "interactive" | "active-voice";

export type CompanionPresenceState =
  | "idle"
  | "observing"
  | "thinking"
  | "speaking"
  | "listening"
  | "drafting"
  | "muted"
  | "error";

export type CompanionRuntimeSettings = {
  enabled: boolean;
  proactiveObservations: boolean;
  mode: CompanionMode;
  language: SummaryLanguage;
};

export type CompanionObservation = {
  id: string;
  conversationId: string;
  messageIds: string[];
  category: "question" | "coordination" | "sensitive";
  text: string;
};

export type CompanionRuntimeEvent =
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
      settings: CompanionRuntimeSettings;
    }
  | {
      type: "user-input";
      source: "text" | "voice";
    }
  | {
      type: "inference-completed";
      outcome: "success" | "error" | "cancelled";
    }
  | {
      type: "activity-updated";
      state: CompanionPresenceState;
    }
  | { type: "cancel" }
  | { type: "dispose" };

type RuntimeOptions = {
  debounceMs?: number;
  onObservation: (observation: CompanionObservation) => void;
  onStateChange?: (state: CompanionPresenceState) => void;
  onMessageEvent?: (
    event: {
      type: "incoming-message" | "outgoing-message";
      conversationId: string;
      messageId: string;
    },
  ) => void;
};

export type CompanionRuntime = {
  dispatch(event: CompanionRuntimeEvent): void;
  dispose(): void;
};

type RelevantMessage = {
  id: string;
  category: CompanionObservation["category"] | null;
  language: "english" | "arabic";
};

const maxRememberedMessages = 250;
const maxPendingMessages = 25;

export function classifyCompanionMessage(
  message: Pick<LocalMessage, "plaintext">,
): CompanionObservation["category"] | null {
  const text = message.plaintext.trim();
  if (text.length < 4 || text.length > 2_000) {
    return null;
  }

  if (
    /\b(suicid\w*|self[- ]?harm|hurt(?:ing)? myself|abuse|assault|rape|cancer|diagnos\w*|hospital|death|died|funeral|divorc\w*|panic attack|i feel alone|i feel unsafe)\b|انتحار|إيذاء|اعتداء|اغتصاب|سرطان|مستشفى|وفاة|طلاق|نوبة هلع|حاسس.*(?:لوحدي|لحالي|مش بأمان)/i.test(
      text,
    )
  ) {
    return "sensitive";
  }

  if (/[?؟]/u.test(text) || /\b(?:what|when|where|who|why|how|can you|could you)\b/i.test(text)) {
    return "question";
  }

  if (
    /\b(?:meet|meeting|schedule|reschedule|plan|time|tomorrow|today|friday|saturday|sunday|next week|available|free later|let's|lets)\b|بكرا|غدا|موعد|نأجل|نتلاقى|الأسبوع الجاي/i.test(
      text,
    )
  ) {
    return "coordination";
  }

  return null;
}

function observationText(
  category: CompanionObservation["category"],
  language: "english" | "arabic",
) {
  if (language === "arabic") {
    switch (category) {
      case "question":
        return "في سؤال بالمحادثة. إذا بتحب، بقدر أساعدك تفكر برد مناسب.";
      case "coordination":
        return "في ترتيب أو موعد عم بتنسقوه. بقدر أساعدك تقارن الخيارات أو تصيغ رد واضح.";
      case "sensitive":
        return "يمكن تكون لحظة حساسة. رح أضل هادي، وبقدر أساعدك إذا حبيت.";
    }
  }
  switch (category) {
    case "question":
      return "There’s a question in the conversation. I can help you think through a reply if you want.";
    case "coordination":
      return "You’re coordinating a plan. I can help compare options or draft a clear reply.";
    case "sensitive":
      return "This may be a sensitive moment. I’ll stay thoughtful and can help if you want.";
  }
}

export function createCompanionRuntime({
  debounceMs = 850,
  onObservation,
  onStateChange,
  onMessageEvent,
}: RuntimeOptions): CompanionRuntime {
  let conversationId: string | null = null;
  let initialized = false;
  let settings: CompanionRuntimeSettings = {
    enabled: false,
    proactiveObservations: false,
    mode: "quiet",
    language: "auto",
  };
  let currentActivity: CompanionPresenceState = "idle";
  let pending: RelevantMessage[] = [];
  let lastProcessedOrder = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observingTimer: ReturnType<typeof setTimeout> | undefined;
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const seenIds = new Set<string>();

  function restingState(): CompanionPresenceState {
    if (!settings.enabled || !settings.proactiveObservations || settings.mode === "quiet") {
      return "muted";
    }
    return "idle";
  }

  function setState(state: CompanionPresenceState) {
    if (disposed) {
      return;
    }
    if (observingTimer) {
      clearTimeout(observingTimer);
      observingTimer = undefined;
    }
    if (currentActivity === state) {
      return;
    }
    if (state !== "drafting" && activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = undefined;
    }
    currentActivity = state;
    onStateChange?.(state);
  }

  function cancelPending() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (observingTimer) {
      clearTimeout(observingTimer);
      observingTimer = undefined;
    }
    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = undefined;
    }
    pending = [];
  }

  function clearRememberedMessages() {
    seenIds.clear();
    initialized = false;
    lastProcessedOrder = "";
  }

  function scheduleObservation() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (
        disposed ||
        !settings.enabled ||
        !settings.proactiveObservations ||
        settings.mode === "quiet" ||
        !conversationId ||
        pending.length === 0
      ) {
        setState(restingState());
        return;
      }

      const batch = pending;
      pending = [];
      const latest = [...batch].reverse().find(({ category }) => category);
      if (!latest?.category) {
        setState(restingState());
        return;
      }
      const observation: CompanionObservation = {
        id: `${conversationId}:${batch.map(({ id }) => id).join(",")}`,
        conversationId,
        messageIds: batch.map(({ id }) => id),
        category: latest.category,
        text: observationText(
          latest.category,
          settings.language === "arabic" ||
            (settings.language === "auto" && latest.language === "arabic")
            ? "arabic"
            : "english",
        ),
      };
      onObservation(observation);
      setState("observing");
      observingTimer = setTimeout(() => {
        observingTimer = undefined;
        setState(restingState());
      }, 2_500);
    }, debounceMs);
  }

  function synchronizeMessages(
    nextConversationId: string,
    messages: LocalMessage[],
  ) {
    if (conversationId !== nextConversationId) {
      cancelPending();
      clearRememberedMessages();
      conversationId = nextConversationId;
    }

    const ordered = messages
      .filter((message) => message.conversationId === nextConversationId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    if (!initialized) {
      for (const message of ordered.slice(-maxRememberedMessages)) {
        seenIds.add(message.id);
      }
      const latest = ordered[ordered.length - 1];
      lastProcessedOrder = latest ? `${latest.createdAt}:${latest.id}` : "";
      initialized = true;
      setState(restingState());
      return;
    }

    const unseen = ordered.filter((message) => !seenIds.has(message.id));
    for (const message of unseen) {
      const messageOrder = `${message.createdAt}:${message.id}`;
      if (messageOrder <= lastProcessedOrder) {
        continue;
      }
      lastProcessedOrder = messageOrder;
      seenIds.add(message.id);
      if (seenIds.size > maxRememberedMessages) {
        const oldest = seenIds.values().next().value;
        if (oldest !== undefined) {
          seenIds.delete(oldest);
        }
      }
      onMessageEvent?.({
        type: message.fromMe ? "outgoing-message" : "incoming-message",
        conversationId: nextConversationId,
        messageId: message.id,
      });

      if (message.fromMe) {
        cancelPending();
        setState(restingState());
        continue;
      }
      const category = classifyCompanionMessage(message);
      pending.push({
        id: message.id,
        category,
        language: /\p{Script=Arabic}/u.test(message.plaintext)
          ? "arabic"
          : "english",
      });
      if (pending.length > maxPendingMessages) {
        pending.shift();
      }
      if (category) {
        setState("observing");
      }
      scheduleObservation();
    }
  }

  function dispatch(event: CompanionRuntimeEvent) {
    if (disposed && event.type !== "mount") {
      return;
    }
    switch (event.type) {
      case "mount":
        disposed = false;
        break;
      case "conversation-selected":
        if (conversationId !== event.conversationId) {
          cancelPending();
          clearRememberedMessages();
          conversationId = event.conversationId;
          setState(restingState());
        }
        break;
      case "messages-loaded":
        synchronizeMessages(event.conversationId, event.messages);
        break;
      case "settings-updated":
        settings = event.settings;
        if (
          !settings.enabled ||
          !settings.proactiveObservations ||
          settings.mode === "quiet"
        ) {
          cancelPending();
        }
        setState(restingState());
        break;
      case "user-input":
        setState(event.source === "voice" ? "listening" : "thinking");
        break;
      case "inference-completed":
        setState(event.outcome === "error" ? "error" : restingState());
        break;
      case "activity-updated":
        if (activityTimer) {
          clearTimeout(activityTimer);
          activityTimer = undefined;
        }
        setState(event.state === "idle" ? restingState() : event.state);
        if (event.state === "drafting") {
          activityTimer = setTimeout(() => {
            activityTimer = undefined;
            setState(restingState());
          }, 1_500);
        }
        break;
      case "cancel":
        cancelPending();
        setState(restingState());
        break;
      case "dispose":
        dispose();
        break;
    }
  }

  function dispose() {
    if (disposed) {
      return;
    }
    cancelPending();
    clearRememberedMessages();
    disposed = true;
  }

  return { dispatch, dispose };
}
