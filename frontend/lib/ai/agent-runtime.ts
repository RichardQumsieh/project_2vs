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
    }
  | {
      type: "draft_email";
      provider: "gmail" | "outlook-mail";
      to: string[];
      subject: string;
      body: string;
      cc?: string[];
      delivery?: "send" | "draft";
      contentType?: "text/plain" | "text/html";
      html?: string;
    }
  | {
      type: "create_calendar_event";
      provider: "google" | "outlook";
      title: string;
      startsAt: string;
      endsAt: string;
      allDay?: boolean;
      description?: string;
    }
  | {
      type: "create_github_issue";
      owner: string;
      repo: string;
      title: string;
      body?: string;
    }
  | {
      type: "create_linear_issue";
      title: string;
      teamId: string;
      description?: string;
    }
  | {
      type: "post_slack_message";
      channelId: string;
      channelName?: string;
      text: string;
    }
  | {
      type: "propose_follow_up";
      title: string;
      dueAt?: string;
      conversationId?: string;
      sourceFindingId?: string;
      notes?: string;
    }
  | {
      type: "reschedule_commitment";
      taskDraftId: string;
      title: string;
      dueAt: string;
      previousDueAt?: string;
      calendarProvider?: "google" | "outlook";
      externalEventId?: string;
      startsAt?: string;
      endsAt?: string;
    };

export type AgentProposalProvenance =
  | "command"
  | "briefing"
  | "radar"
  | "deadline"
  | "companion";

export type AgentProposal = {
  id: string;
  action: AgentToolAction;
  createdAt: number;
  expiresAt: number;
  provenance?: AgentProposalProvenance;
};

export type ProposeOptions = {
  provenance?: AgentProposalProvenance;
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
  draftEmail: (
    action: Extract<AgentToolAction, { type: "draft_email" }>,
  ) => void | Promise<void>;
  createCalendarEvent: (
    action: Extract<AgentToolAction, { type: "create_calendar_event" }>,
  ) => void | Promise<void>;
  createGitHubIssue: (
    action: Extract<AgentToolAction, { type: "create_github_issue" }>,
  ) => void | Promise<void>;
  createLinearIssue: (
    action: Extract<AgentToolAction, { type: "create_linear_issue" }>,
  ) => void | Promise<void>;
  postSlackMessage: (
    action: Extract<AgentToolAction, { type: "post_slack_message" }>,
  ) => void | Promise<void>;
  proposeFollowUp: (
    action: Extract<AgentToolAction, { type: "propose_follow_up" }>,
  ) => void | Promise<void>;
  rescheduleCommitment: (
    action: Extract<AgentToolAction, { type: "reschedule_commitment" }>,
  ) => void | Promise<void>;
};

export type AgentRuntime = {
  propose(action: AgentToolAction, options?: ProposeOptions): AgentProposal;
  revise(
    id: string,
    action: AgentToolAction,
    options?: ProposeOptions,
  ): AgentProposal;
  approve(id: string): Promise<void>;
  cancel(id: string): boolean;
  cancelAll(): void;
  getProposals(): AgentProposal[];
  getAudit(): AgentAuditEntry[];
};

const maxPendingProposals = 8;
const maxAuditEntries = 50;
const proposalLifetimeMs = 5 * 60_000;

function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function validateStringList(
  values: unknown,
  options: { min: number; max: number; itemMax: number; label: string },
) {
  if (!Array.isArray(values)) {
    throw new Error(`${options.label} must be a list.`);
  }
  if (values.length < options.min || values.length > options.max) {
    throw new Error(
      `${options.label} requires ${options.min} to ${options.max} entries.`,
    );
  }
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim() || value.length > options.itemMax) {
      throw new Error(`${options.label} contains an invalid entry.`);
    }
    normalized.push(value.trim());
  }
  return normalized;
}

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
    case "draft_email":
      return action.delivery === "send"
        ? `Send ${action.provider} email to ${action.to.join(", ")}`
        : `Create ${action.provider} draft to ${action.to.join(", ")}`;
    case "create_calendar_event":
      return `Create ${action.provider} calendar event “${action.title}”`;
    case "create_github_issue":
      return `Create GitHub issue in ${action.owner}/${action.repo}`;
    case "create_linear_issue":
      return `Create Linear issue “${action.title}”`;
    case "post_slack_message":
      return `Post Slack message to ${
        action.channelName ? `#${action.channelName}` : action.channelId
      }`;
    case "propose_follow_up":
      return `Save follow-up “${action.title}” on this device`;
    case "reschedule_commitment":
      return `Reschedule “${action.title}” to ${action.dueAt.slice(0, 10)}`;
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
      case "draft_email": {
        if (
          action.provider !== "gmail" &&
          action.provider !== "outlook-mail"
        ) {
          throw new Error("The email provider is not allowed.");
        }
        const to = validateStringList(action.to, {
          min: 1,
          max: 20,
          itemMax: 320,
          label: "Email recipients",
        });
        if (!to.every(isEmailAddress)) {
          throw new Error("Email recipients must be valid addresses.");
        }
        if (action.cc !== undefined) {
          const cc = validateStringList(action.cc, {
            min: 0,
            max: 20,
            itemMax: 320,
            label: "Email cc",
          });
          if (!cc.every(isEmailAddress)) {
            throw new Error("Email cc must be valid addresses.");
          }
        }
        if (
          typeof action.subject !== "string" ||
          !action.subject.trim() ||
          action.subject.length > 200 ||
          action.subject.includes("\u0000") ||
          action.subject.includes("\n") ||
          action.subject.includes("\r") ||
          typeof action.body !== "string" ||
          !action.body.trim() ||
          action.body.length > 20_000 ||
          action.body.includes("\u0000")
        ) {
          throw new Error("The email draft action is malformed.");
        }
        if (action.contentType === "text/html") {
          if (
            typeof action.html !== "string" ||
            !action.html.trim() ||
            action.html.length > 40_000 ||
            action.html.includes("\u0000") ||
            /<\s*script/i.test(action.html)
          ) {
            throw new Error("The email HTML payload is not allowed.");
          }
        }
        break;
      }
      case "create_calendar_event": {
        if (action.provider !== "google" && action.provider !== "outlook") {
          throw new Error("The calendar provider is not allowed.");
        }
        if (
          typeof action.title !== "string" ||
          !action.title.trim() ||
          action.title.length > 200 ||
          action.title.includes("\u0000") ||
          typeof action.startsAt !== "string" ||
          Number.isNaN(Date.parse(action.startsAt)) ||
          typeof action.endsAt !== "string" ||
          Number.isNaN(Date.parse(action.endsAt)) ||
          Date.parse(action.endsAt) < Date.parse(action.startsAt) ||
          (action.description !== undefined &&
            (typeof action.description !== "string" ||
              action.description.length > 4_000 ||
              action.description.includes("\u0000")))
        ) {
          throw new Error("The calendar event action is malformed.");
        }
        break;
      }
      case "create_github_issue":
        if (
          typeof action.owner !== "string" ||
          !/^[A-Za-z0-9_.-]+$/.test(action.owner) ||
          typeof action.repo !== "string" ||
          !/^[A-Za-z0-9_.-]+$/.test(action.repo) ||
          typeof action.title !== "string" ||
          !action.title.trim() ||
          action.title.length > 256 ||
          action.title.includes("\u0000") ||
          (action.body !== undefined &&
            (typeof action.body !== "string" ||
              action.body.length > 20_000 ||
              action.body.includes("\u0000")))
        ) {
          throw new Error("The GitHub issue action is malformed.");
        }
        break;
      case "create_linear_issue":
        if (
          typeof action.title !== "string" ||
          !action.title.trim() ||
          action.title.length > 256 ||
          action.title.includes("\u0000") ||
          typeof action.teamId !== "string" ||
          !action.teamId.trim() ||
          action.teamId.length > 64 ||
          (action.description !== undefined &&
            (typeof action.description !== "string" ||
              action.description.length > 20_000 ||
              action.description.includes("\u0000")))
        ) {
          throw new Error("The Linear issue action is malformed.");
        }
        break;
      case "post_slack_message":
        if (
          typeof action.channelId !== "string" ||
          !/^[CGD][A-Z0-9]+$/i.test(action.channelId) ||
          action.channelId.length > 32 ||
          typeof action.text !== "string" ||
          !action.text.trim() ||
          action.text.length > 4_000 ||
          action.text.includes("\u0000") ||
          (action.channelName !== undefined &&
            (typeof action.channelName !== "string" ||
              action.channelName.length > 80))
        ) {
          throw new Error("The Slack message action is malformed.");
        }
        break;
      case "propose_follow_up":
        if (
          typeof action.title !== "string" ||
          !action.title.trim() ||
          action.title.length > 160 ||
          action.title.includes("\u0000") ||
          (action.dueAt !== undefined &&
            (typeof action.dueAt !== "string" ||
              action.dueAt.length > 40 ||
              Number.isNaN(Date.parse(action.dueAt)))) ||
          (action.conversationId !== undefined &&
            (typeof action.conversationId !== "string" ||
              action.conversationId.length > 120)) ||
          (action.sourceFindingId !== undefined &&
            (typeof action.sourceFindingId !== "string" ||
              action.sourceFindingId.length > 120)) ||
          (action.notes !== undefined &&
            (typeof action.notes !== "string" ||
              action.notes.length > 2_000 ||
              action.notes.includes("\u0000")))
        ) {
          throw new Error("The follow-up action is malformed.");
        }
        break;
      case "reschedule_commitment":
        if (
          typeof action.taskDraftId !== "string" ||
          !action.taskDraftId.trim() ||
          action.taskDraftId.length > 120 ||
          typeof action.title !== "string" ||
          !action.title.trim() ||
          action.title.length > 160 ||
          action.title.includes("\u0000") ||
          typeof action.dueAt !== "string" ||
          !action.dueAt.trim() ||
          action.dueAt.length > 40 ||
          Number.isNaN(Date.parse(action.dueAt)) ||
          (action.previousDueAt !== undefined &&
            (typeof action.previousDueAt !== "string" ||
              action.previousDueAt.length > 40)) ||
          (action.calendarProvider !== undefined &&
            action.calendarProvider !== "google" &&
            action.calendarProvider !== "outlook") ||
          (action.externalEventId !== undefined &&
            (typeof action.externalEventId !== "string" ||
              action.externalEventId.length > 200)) ||
          (action.startsAt !== undefined &&
            (typeof action.startsAt !== "string" ||
              Number.isNaN(Date.parse(action.startsAt)))) ||
          (action.endsAt !== undefined &&
            (typeof action.endsAt !== "string" ||
              Number.isNaN(Date.parse(action.endsAt))))
        ) {
          throw new Error("The reschedule action is malformed.");
        }
        break;
      default:
        throw new Error("This agent tool is not allowed.");
    }
  }

  async function execute(action: AgentToolAction) {
    switch (action.type) {
      case "send_message":
        await handlers.sendMessage(action);
        break;
      case "web_search":
        handlers.webSearch(action);
        break;
      case "ui":
        handlers.ui(action);
        break;
      case "create_document":
        await handlers.createDocument(action);
        break;
      case "remember_fact":
        handlers.rememberFact(action);
        break;
      case "forget_fact":
        handlers.forgetFact(action);
        break;
      case "draft_message":
        handlers.draftMessage(action);
        break;
      case "accept_finding":
        await handlers.acceptFinding(action);
        break;
      case "dismiss_finding":
        await handlers.dismissFinding(action);
        break;
      case "snooze_reminder":
        await handlers.snoozeReminder(action);
        break;
      case "draft_email":
        await handlers.draftEmail(action);
        break;
      case "create_calendar_event":
        await handlers.createCalendarEvent(action);
        break;
      case "create_github_issue":
        await handlers.createGitHubIssue(action);
        break;
      case "create_linear_issue":
        await handlers.createLinearIssue(action);
        break;
      case "post_slack_message":
        await handlers.postSlackMessage(action);
        break;
      case "propose_follow_up":
        await handlers.proposeFollowUp(action);
        break;
      case "reschedule_commitment":
        await handlers.rescheduleCommitment(action);
        break;
    }
  }

  return {
    propose(action, options) {
      expireOldProposals();
      validateAction(action);
      if (proposals.size >= maxPendingProposals) {
        throw new Error("Review or cancel a pending action before proposing another.");
      }
      const timestamp = now();
      const proposal: AgentProposal = {
        id: createId(),
        action: structuredClone(action),
        createdAt: timestamp,
        expiresAt: timestamp + proposalLifetimeMs,
        ...(options?.provenance ? { provenance: options.provenance } : {}),
      };
      proposals.set(proposal.id, proposal);
      publish();
      return proposal;
    },
    revise(id, action, options) {
      expireOldProposals();
      const existing = proposals.get(id);
      if (!existing) {
        throw new Error("This action is no longer available. Review it again.");
      }
      validateAction(action);
      const timestamp = now();
      const provenance = options?.provenance ?? existing.provenance;
      const proposal: AgentProposal = {
        id,
        action: structuredClone(action),
        createdAt: existing.createdAt,
        expiresAt: timestamp + proposalLifetimeMs,
        ...(provenance ? { provenance } : {}),
      };
      proposals.set(id, proposal);
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
        await execute(proposal.action);
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
