import type {
  AgentProposalProvenance,
  AgentToolAction,
} from "./agent-runtime";
import { isJobManagerTool } from "./sophia-job-tools";

export type { AgentProposalProvenance };

export type ProviderBadgeId =
  | "gmail"
  | "outlook-mail"
  | "google-calendar"
  | "outlook-calendar"
  | "github"
  | "linear"
  | "slack"
  | "local"
  | "web"
  | "document";

export type ProviderBadge = {
  id: ProviderBadgeId;
  label: string;
  tone: "amber" | "cyan" | "emerald" | "violet" | "sky" | "rose" | "slate";
};

export type PayloadField = {
  label: string;
  value: string;
};

export type SlashHint = {
  id: string;
  label: string;
  insert: string;
  description: string;
};

export const SOPHIA_MENTION_CHIPS = [
  { id: "mention", label: "@Sophia", insert: "@Sophia " },
  { id: "wake", label: "Sophia,", insert: "Sophia, " },
] as const;

export const SOPHIA_SLASH_HINTS: SlashHint[] = [
  {
    id: "schedule",
    label: "/schedule",
    insert: "Sophia, schedule 30m ",
    description: "Calendar hold",
  },
  {
    id: "email",
    label: "/email",
    insert: "Sophia, draft email to ",
    description: "Email",
  },
  {
    id: "github",
    label: "/github",
    insert: "Sophia, file GitHub issue ",
    description: "GitHub issue",
  },
  {
    id: "linear",
    label: "/linear",
    insert: "Sophia, file Linear for ",
    description: "Linear issue",
  },
  {
    id: "slack",
    label: "/slack",
    insert: "Sophia, draft Slack to #",
    description: "Slack post",
  },
  {
    id: "follow-up",
    label: "/follow-up",
    insert: "Sophia, follow up on ",
    description: "Local reminder",
  },
  {
    id: "reschedule",
    label: "/reschedule",
    insert: "Sophia, reschedule ",
    description: "Move a due date",
  },
];

export function provenanceLabel(
  provenance?: AgentProposalProvenance | null,
): string | null {
  switch (provenance) {
    case "briefing":
      return "From briefing";
    case "radar":
      return "From radar";
    case "deadline":
      return "From deadline scan";
    case "command":
      return "From command";
    case "companion":
      return "From chat";
    default:
      return null;
  }
}

export function providerBadgeForAction(
  action: AgentToolAction,
): ProviderBadge {
  switch (action.type) {
    case "draft_email":
      return action.provider === "outlook-mail"
        ? { id: "outlook-mail", label: "Outlook Mail", tone: "sky" }
        : { id: "gmail", label: "Gmail", tone: "rose" };
    case "create_calendar_event":
      return action.provider === "outlook"
        ? {
            id: "outlook-calendar",
            label: "Outlook Calendar",
            tone: "sky",
          }
        : { id: "google-calendar", label: "Google Calendar", tone: "emerald" };
    case "create_github_issue":
      return { id: "github", label: "GitHub", tone: "slate" };
    case "create_linear_issue":
      return { id: "linear", label: "Linear", tone: "violet" };
    case "post_slack_message":
      return { id: "slack", label: "Slack", tone: "amber" };
    case "propose_follow_up":
    case "reschedule_commitment":
    case "accept_finding":
    case "dismiss_finding":
    case "snooze_reminder":
    case "remember_fact":
    case "forget_fact":
      return { id: "local", label: "On device", tone: "emerald" };
    case "web_search":
      return { id: "web", label: "Web", tone: "cyan" };
    case "create_document":
      return { id: "document", label: "Document", tone: "cyan" };
    case "draft_message":
    case "send_message":
      return { id: "local", label: "Chat draft", tone: "emerald" };
    case "ui":
      return { id: "local", label: "UI", tone: "slate" };
  }
}

export function outboundPayloadFields(
  action: AgentToolAction,
): PayloadField[] {
  switch (action.type) {
    case "draft_email":
      return [
        {
          label: "Delivery",
          value: action.delivery === "send" ? "send" : "draft",
        },
        { label: "Provider", value: action.provider },
        { label: "To", value: action.to.join(", ") },
        ...(action.cc?.length
          ? [{ label: "Cc", value: action.cc.join(", ") }]
          : []),
        { label: "Subject", value: action.subject },
        {
          label: "Content-Type",
          value: action.contentType ?? (action.html ? "text/html" : "text/plain"),
        },
        { label: "Plain body", value: action.body },
        ...(action.html
          ? [{ label: "HTML body", value: action.html }]
          : []),
      ];
    case "create_calendar_event":
      return [
        { label: "Provider", value: action.provider },
        { label: "Title", value: action.title },
        { label: "Starts", value: action.startsAt },
        { label: "Ends", value: action.endsAt },
        ...(action.allDay ? [{ label: "All day", value: "yes" }] : []),
        ...(action.description
          ? [{ label: "Description", value: action.description }]
          : []),
      ];
    case "create_github_issue":
      return [
        { label: "Repo", value: `${action.owner}/${action.repo}` },
        { label: "Title", value: action.title },
        ...(action.body ? [{ label: "Body", value: action.body }] : []),
      ];
    case "create_linear_issue":
      return [
        { label: "Team id", value: action.teamId },
        { label: "Title", value: action.title },
        ...(action.description
          ? [{ label: "Description", value: action.description }]
          : []),
      ];
    case "post_slack_message":
      return [
        { label: "Channel id", value: action.channelId },
        ...(action.channelName
          ? [{ label: "Channel", value: `#${action.channelName}` }]
          : []),
        { label: "Text", value: action.text },
      ];
    case "propose_follow_up":
      return [
        { label: "Title", value: action.title },
        ...(action.dueAt ? [{ label: "Due", value: action.dueAt }] : []),
        ...(action.notes ? [{ label: "Notes", value: action.notes }] : []),
        ...(action.sourceFindingId
          ? [{ label: "Finding", value: action.sourceFindingId }]
          : []),
      ];
    case "reschedule_commitment":
      return [
        { label: "Task", value: action.title },
        { label: "New due", value: action.dueAt },
        ...(action.previousDueAt
          ? [{ label: "Previous due", value: action.previousDueAt }]
          : []),
        { label: "Task draft id", value: action.taskDraftId },
      ];
    case "web_search":
      return [
        { label: "Provider", value: action.provider },
        { label: "Query", value: action.query },
      ];
    case "create_document":
      return [
        { label: "Filename", value: action.filename },
        { label: "Title", value: action.title },
        { label: "MIME", value: action.mimeType },
        { label: "Body", value: action.body.slice(0, 2_000) },
      ];
    case "draft_message":
    case "send_message":
      return [
        { label: "To", value: `@${action.recipientUsername}` },
        { label: "Body", value: action.body },
      ];
    case "remember_fact":
      return [{ label: "Fact", value: action.fact }];
    case "forget_fact":
      return [{ label: "Match", value: action.query }];
    case "accept_finding":
      return [
        { label: "Finding", value: action.findingId },
        { label: "Title", value: action.title },
        ...(action.dueAt ? [{ label: "Due", value: action.dueAt }] : []),
      ];
    case "dismiss_finding":
      return [{ label: "Finding", value: action.findingId }];
    case "snooze_reminder":
      return [
        { label: "Finding", value: action.findingId },
        { label: "Until", value: action.until },
      ];
    case "ui":
      return [{ label: "Action", value: action.action }];
  }
}

export function approveVerb(action: AgentToolAction): string {
  if (isJobManagerTool(action.type)) {
    switch (action.type) {
      case "draft_email":
        return action.delivery === "send" ? "Approve send" : "Approve draft";
      case "post_slack_message":
        return "Approve post";
      case "create_calendar_event":
        return "Approve event";
      case "create_github_issue":
      case "create_linear_issue":
        return "Approve issue";
      case "propose_follow_up":
        return "Approve follow-up";
      case "reschedule_commitment":
        return "Approve reschedule";
    }
  }
  return "Approve";
}

export function filterSlashHints(input: string): SlashHint[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  const token = trimmed.split(/\s/, 1)[0]?.toLowerCase() ?? "/";
  return SOPHIA_SLASH_HINTS.filter(
    (hint) =>
      hint.label.startsWith(token) ||
      hint.id.startsWith(token.slice(1)),
  );
}

export function badgeToneClass(tone: ProviderBadge["tone"]): string {
  switch (tone) {
    case "amber":
      return "border-amber-300/25 bg-amber-300/10 text-amber-100/85";
    case "cyan":
      return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100/85";
    case "emerald":
      return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100/85";
    case "violet":
      return "border-violet-300/25 bg-violet-300/10 text-violet-100/85";
    case "sky":
      return "border-sky-300/25 bg-sky-300/10 text-sky-100/85";
    case "rose":
      return "border-rose-300/25 bg-rose-300/10 text-rose-100/85";
    case "slate":
      return "border-white/15 bg-white/[0.06] text-white/75";
  }
}
