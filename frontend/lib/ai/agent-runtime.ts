export type AgentToolAction =
  | {
      type: "send_message";
      conversationId: string;
      recipientUsername: string;
      body: string;
    }
  | {
      type: "web_search";
      query: string;
      provider: "duckduckgo";
    }
  | {
      type: "ui";
      action: "open_companion" | "dismiss_observation";
    }
  | {
      type: "create_document";
      filename: string;
      title: string;
      body: string;
      mimeType:
        | "text/markdown"
        | "text/plain"
        | "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      presentation?: {
        title: string;
        audience: string;
        due: string;
        subject: string;
        notes: string;
      };
    }
  | {
      type: "remember_fact";
      fact: string;
    }
  | {
      type: "forget_fact";
      query: string;
    }
  | {
      type: "draft_message";
      conversationId: string;
      recipientUsername: string;
      body: string;
    }
  | {
      type: "accept_finding";
      findingId: string;
      title: string;
      dueAt?: string;
    }
  | {
      type: "dismiss_finding";
      findingId: string;
    }
  | {
      type: "snooze_reminder";
      findingId: string;
      until: string;
    };

export type AgentProposal = {
  id: string;
  action: AgentToolAction;
  createdAt: number;
  expiresAt: number;
};

export type AgentAuditEntry = {
  tool: AgentToolAction["type"];
  outcome: "approved" | "cancelled" | "expired" | "rejected" | "failed";
  timestamp: number;
};

export type AgentContext = {
  conversationId: string | null;
  recipientUsername: string | null;
};

export type AgentToolHandlers = {
  sendMessage: (action: Extract<AgentToolAction, { type: "send_message" }>) => Promise<void>;
  webSearch: (action: Extract<AgentToolAction, { type: "web_search" }>) => void;
  ui: (action: Extract<AgentToolAction, { type: "ui" }>) => void;
  createDocument: (
    action: Extract<AgentToolAction, { type: "create_document" }>,
  ) => void | Promise<void>;
  rememberFact: (
    action: Extract<AgentToolAction, { type: "remember_fact" }>,
  ) => void;
  forgetFact: (
    action: Extract<AgentToolAction, { type: "forget_fact" }>,
  ) => void;
  draftMessage: (
    action: Extract<AgentToolAction, { type: "draft_message" }>,
  ) => void;
  acceptFinding: (
    action: Extract<AgentToolAction, { type: "accept_finding" }>,
  ) => void | Promise<void>;
  dismissFinding: (
    action: Extract<AgentToolAction, { type: "dismiss_finding" }>,
  ) => void | Promise<void>;
  snoozeReminder: (
    action: Extract<AgentToolAction, { type: "snooze_reminder" }>,
  ) => void | Promise<void>;
};

export type AgentRuntime = {
  propose(action: AgentToolAction): AgentProposal;
  approve(id: string): Promise<void>;
  cancel(id: string): boolean;
  cancelAll(): void;
  getProposals(): AgentProposal[];
  getAudit(): AgentAuditEntry[];
};

const maxPendingProposals = 8;
const maxAuditEntries = 50;
const proposalLifetimeMs = 5 * 60_000;

export function buildApprovedSearchUrl(query: string) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

export function agentActionSummary(action: AgentToolAction) {
  switch (action.type) {
    case "send_message":
      return `Send the reviewed message to @${action.recipientUsername}`;
    case "web_search":
      return `Open a DuckDuckGo search for “${action.query}”`;
    case "ui":
      return action.action === "open_companion"
        ? "Open Sophia"
        : "Dismiss the observation";
    case "create_document":
      return action.mimeType.includes("presentationml")
        ? `Download PowerPoint ${action.filename}`
        : `Download ${action.filename}`;
    case "remember_fact":
      return "Store a personal note on this device";
    case "forget_fact":
      return "Remove a matching personal note";
    case "draft_message":
      return `Fill the composer for @${action.recipientUsername}`;
    case "accept_finding":
      return `Save local task “${action.title}”`;
    case "dismiss_finding":
      return "Dismiss this Radar finding";
    case "snooze_reminder":
      return `Snooze this reminder until ${action.until.slice(0, 10)}`;
  }
}

export function createAgentRuntime({
  getContext,
  handlers,
  onProposalsChanged,
  now = Date.now,
  createId = () => crypto.randomUUID(),
}: {
  getContext: () => AgentContext;
  handlers: AgentToolHandlers;
  onProposalsChanged?: (proposals: AgentProposal[]) => void;
  now?: () => number;
  createId?: () => string;
}): AgentRuntime {
  const proposals = new Map<string, AgentProposal>();
  const audit: AgentAuditEntry[] = [];

  function record(tool: AgentToolAction["type"], outcome: AgentAuditEntry["outcome"]) {
    audit.push({ tool, outcome, timestamp: now() });
    if (audit.length > maxAuditEntries) {
      audit.shift();
    }
  }

  function publish() {
    onProposalsChanged?.([...proposals.values()]);
  }

  function expireOldProposals() {
    let changed = false;
    for (const [id, proposal] of proposals) {
      if (proposal.expiresAt <= now()) {
        proposals.delete(id);
        record(proposal.action.type, "expired");
        changed = true;
      }
    }
    if (changed) {
      publish();
    }
  }

  function validateAction(action: AgentToolAction, checkContext = true) {
    if (typeof action !== "object" || action === null) {
      throw new Error("This agent action is malformed.");
    }
    switch (action.type) {
      case "send_message": {
        if (
          typeof action.conversationId !== "string" ||
          typeof action.recipientUsername !== "string" ||
          typeof action.body !== "string"
        ) {
          throw new Error("The message action is malformed.");
        }
        const context = getContext();
        if (
          checkContext &&
          (!context.conversationId ||
            !context.recipientUsername ||
            action.conversationId !== context.conversationId ||
            action.recipientUsername !== context.recipientUsername)
        ) {
          throw new Error("The recipient or active conversation changed. Review the message again.");
        }
        if (
          !action.body.trim() ||
          action.body.length > 4_000 ||
          action.body.includes("\u0000")
        ) {
          throw new Error("Messages must contain 1 to 4,000 characters.");
        }
        break;
      }
      case "web_search":
        if (
          typeof action.query !== "string" ||
          action.provider !== "duckduckgo" ||
          !action.query.trim() ||
          action.query.length > 300
        ) {
          throw new Error("Web searches require a specific query of 1 to 300 characters.");
        }
        break;
      case "ui":
        if (
          action.action !== "open_companion" &&
          action.action !== "dismiss_observation"
        ) {
          throw new Error("This interface action is not allowed.");
        }
        break;
      case "create_document": {
        const allowedMime =
          action.mimeType === "text/markdown" ||
          action.mimeType === "text/plain" ||
          action.mimeType ===
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        if (
          typeof action.filename !== "string" ||
          typeof action.title !== "string" ||
          typeof action.body !== "string" ||
          !allowedMime ||
          !action.filename.trim() ||
          action.filename.length > 80 ||
          /[\\/]/.test(action.filename) ||
          !action.body.trim() ||
          action.body.length > 80_000 ||
          action.body.includes("\u0000")
        ) {
          throw new Error("The document action is malformed.");
        }
        if (action.presentation) {
          const presentation = action.presentation;
          if (
            typeof presentation !== "object" ||
            presentation === null ||
            typeof presentation.title !== "string" ||
            typeof presentation.audience !== "string" ||
            typeof presentation.due !== "string" ||
            typeof presentation.subject !== "string" ||
            typeof presentation.notes !== "string" ||
            presentation.title.length > 120 ||
            presentation.audience.length > 120 ||
            presentation.due.length > 80 ||
            presentation.subject.length > 160 ||
            presentation.notes.length > 2_000
          ) {
            throw new Error("The presentation specification is malformed.");
          }
        }
        break;
      }
      case "remember_fact":
        if (
          typeof action.fact !== "string" ||
          !action.fact.trim() ||
          action.fact.length > 240 ||
          action.fact.includes("\u0000")
        ) {
          throw new Error("Personal notes must contain 1 to 240 characters.");
        }
        break;
      case "forget_fact":
        if (
          typeof action.query !== "string" ||
          !action.query.trim() ||
          action.query.length > 240
        ) {
          throw new Error("A specific personal note is required to forget.");
        }
        break;
      case "draft_message": {
        if (
          typeof action.conversationId !== "string" ||
          typeof action.recipientUsername !== "string" ||
          typeof action.body !== "string"
        ) {
          throw new Error("The draft action is malformed.");
        }
        const context = getContext();
        if (
          checkContext &&
          (!context.conversationId ||
            !context.recipientUsername ||
            action.conversationId !== context.conversationId ||
            action.recipientUsername !== context.recipientUsername)
        ) {
          throw new Error("The recipient or active conversation changed. Review the draft again.");
        }
        if (
          !action.body.trim() ||
          action.body.length > 4_000 ||
          action.body.includes("\u0000")
        ) {
          throw new Error("Drafts must contain 1 to 4,000 characters.");
        }
        break;
      }
      case "accept_finding":
        if (
          typeof action.findingId !== "string" ||
          !action.findingId.trim() ||
          action.findingId.length > 120 ||
          typeof action.title !== "string" ||
          !action.title.trim() ||
          action.title.length > 160 ||
          action.title.includes("\u0000") ||
          (action.dueAt !== undefined &&
            (typeof action.dueAt !== "string" ||
              action.dueAt.length > 40 ||
              Number.isNaN(Date.parse(action.dueAt))))
        ) {
          throw new Error("The Radar accept action is malformed.");
        }
        break;
      case "dismiss_finding":
        if (
          typeof action.findingId !== "string" ||
          !action.findingId.trim() ||
          action.findingId.length > 120
        ) {
          throw new Error("The Radar dismiss action is malformed.");
        }
        break;
      case "snooze_reminder":
        if (
          typeof action.findingId !== "string" ||
          !action.findingId.trim() ||
          action.findingId.length > 120 ||
          typeof action.until !== "string" ||
          !action.until.trim() ||
          action.until.length > 40 ||
          Number.isNaN(Date.parse(action.until))
        ) {
          throw new Error("The Radar snooze action is malformed.");
        }
        break;
      default:
        throw new Error("This agent tool is not allowed.");
    }
  }

  return {
    propose(action) {
      expireOldProposals();
      validateAction(action);
      if (proposals.size >= maxPendingProposals) {
        throw new Error("Review or cancel a pending action before proposing another.");
      }
      const timestamp = now();
      const proposal = {
        id: createId(),
        action: structuredClone(action),
        createdAt: timestamp,
        expiresAt: timestamp + proposalLifetimeMs,
      };
      proposals.set(proposal.id, proposal);
      publish();
      return proposal;
    },
    async approve(id) {
      expireOldProposals();
      const proposal = proposals.get(id);
      if (!proposal) {
        throw new Error("This action is no longer available. Review it again.");
      }
      validateAction(proposal.action, false);
      if (
        proposal.action.type === "send_message" ||
        proposal.action.type === "draft_message"
      ) {
        const context = getContext();
        if (
          context.conversationId !== proposal.action.conversationId ||
          context.recipientUsername !== proposal.action.recipientUsername
        ) {
          record(proposal.action.type, "rejected");
          proposals.delete(id);
          publish();
          throw new Error("The recipient or active conversation changed. Review the message again.");
        }
      }
      proposals.delete(id);
      publish();
      record(proposal.action.type, "approved");
      try {
        switch (proposal.action.type) {
          case "send_message":
            await handlers.sendMessage(proposal.action);
            break;
          case "web_search":
            handlers.webSearch(proposal.action);
            break;
          case "ui":
            handlers.ui(proposal.action);
            break;
          case "create_document":
            await handlers.createDocument(proposal.action);
            break;
          case "remember_fact":
            handlers.rememberFact(proposal.action);
            break;
          case "forget_fact":
            handlers.forgetFact(proposal.action);
            break;
          case "draft_message":
            handlers.draftMessage(proposal.action);
            break;
          case "accept_finding":
            await handlers.acceptFinding(proposal.action);
            break;
          case "dismiss_finding":
            await handlers.dismissFinding(proposal.action);
            break;
          case "snooze_reminder":
            await handlers.snoozeReminder(proposal.action);
            break;
        }
      } catch (error) {
        record(proposal.action.type, "failed");
        throw error;
      }
    },
    cancel(id) {
      const proposal = proposals.get(id);
      if (!proposal) {
        return false;
      }
      proposals.delete(id);
      record(proposal.action.type, "cancelled");
      publish();
      return true;
    },
    cancelAll() {
      for (const proposal of proposals.values()) {
        record(proposal.action.type, "cancelled");
      }
      proposals.clear();
      publish();
    },
    getProposals() {
      expireOldProposals();
      return [...proposals.values()];
    },
    getAudit() {
      return [...audit];
    },
  };
}
