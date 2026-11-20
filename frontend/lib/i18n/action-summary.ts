import type { AgentProposalProvenance, AgentToolAction } from "../ai/agent-runtime";
import type { MessageKey, TranslateVars } from "./locale";

type Translate = (key: MessageKey, vars?: TranslateVars) => string;

const fieldKeys: Record<string, MessageKey> = {
  Delivery: "field.delivery",
  Provider: "field.provider",
  To: "field.to",
  Cc: "field.cc",
  Subject: "field.subject",
  Attachments: "field.attachments",
  "Content-Type": "field.contentType",
  "Plain body": "field.plainBody",
  "HTML body": "field.htmlBody",
  Title: "field.title",
  Starts: "field.starts",
  Ends: "field.ends",
  "All day": "field.allDay",
  Description: "field.description",
  Event: "field.event",
  Repo: "field.repo",
  Body: "field.body",
  "Team id": "field.team",
  "Channel id": "field.channelId",
  Channel: "field.channel",
  Text: "field.text",
  Due: "field.due",
  Notes: "field.notes",
  Finding: "field.finding",
  Task: "field.task",
  "New due": "field.newDue",
  "Previous due": "field.previousDue",
  "Task draft id": "field.taskId",
  Query: "field.query",
  Filename: "field.filename",
  MIME: "field.mime",
  Fact: "field.fact",
  Match: "field.match",
  Until: "field.until",
  Action: "field.action",
};

export function localizedFieldLabel(label: string, t: Translate): string {
  const key = fieldKeys[label];
  return key ? t(key) : label;
}

export function localizedFieldValue(label: string, value: string, t: Translate): string {
  if (label === "Delivery" && value === "send") return t("field.send");
  if (label === "Delivery" && value === "draft") return t("field.draft");
  if (label === "All day" && value === "yes") return t("field.yes");
  return value;
}

export function localizedProvenance(
  provenance: AgentProposalProvenance | null | undefined,
  t: Translate,
): string | null {
  switch (provenance) {
    case "briefing":
      return t("approval.fromBriefing");
    case "radar":
      return t("approval.fromRadar");
    case "deadline":
      return t("approval.fromDeadline");
    case "command":
      return t("approval.fromCommand");
    case "companion":
      return t("approval.fromChat");
    default:
      return null;
  }
}

export function localizedProviderLabel(
  _id: string,
  fallback: string,
  t: Translate,
): string {
  switch (fallback) {
    case "Chat draft":
      return t("approval.chatDraft");
    case "On device":
      return t("approval.onDevice");
    case "Web":
      return t("approval.web");
    case "Document":
      return t("approval.document");
    case "UI":
      return t("approval.ui");
    default:
      return fallback;
  }
}

export function localizedApproveVerb(action: AgentToolAction, t: Translate): string {
  switch (action.type) {
    case "draft_email":
      return action.delivery === "send"
        ? t("approval.approveSend")
        : t("approval.approveDraft");
    case "post_slack_message":
      return t("approval.approvePost");
    case "create_calendar_event":
      return t("approval.approveEvent");
    case "delete_calendar_event":
      return t("approval.approveRemoval");
    case "create_github_issue":
    case "create_linear_issue":
      return t("approval.approveIssue");
    case "propose_follow_up":
      return t("approval.approveFollowUp");
    case "reschedule_commitment":
      return t("approval.approveReschedule");
    default:
      return t("approval.approve");
  }
}

export function localizedActionSummary(action: AgentToolAction, t: Translate): string {
  switch (action.type) {
    case "send_message":
      return t("summary.sendMessage", { username: action.recipientUsername });
    case "web_search":
      return t("summary.search", { query: action.query });
    case "ui":
      return action.action === "open_companion"
        ? t("summary.openSophia")
        : t("summary.dismissObservation");
    case "create_document":
      return action.mimeType.includes("presentationml")
        ? t("summary.downloadDeck", { filename: action.filename })
        : t("summary.download", { filename: action.filename });
    case "remember_fact":
      return t("summary.remember");
    case "forget_fact":
      return t("summary.forget");
    case "draft_message":
      return t("summary.fillComposer", { username: action.recipientUsername });
    case "accept_finding":
      return t("summary.saveTask", { title: action.title });
    case "dismiss_finding":
      return t("summary.dismissFinding");
    case "snooze_reminder":
      return t("summary.snooze", { date: action.until.slice(0, 10) });
    case "draft_email":
      return action.delivery === "send"
        ? t("summary.sendEmail", {
            provider: action.provider,
            to: action.to.join(", "),
          })
        : t("summary.draftEmail", {
            provider: action.provider,
            to: action.to.join(", "),
          });
    case "create_calendar_event":
      return t("summary.createEvent", {
        provider: action.provider,
        title: action.title,
      });
    case "delete_calendar_event":
      return t("summary.deleteEvent", {
        provider: action.provider,
        title: action.title,
      });
    case "create_github_issue":
      return t("summary.github", { repo: `${action.owner}/${action.repo}` });
    case "create_linear_issue":
      return t("summary.linear", { title: action.title });
    case "post_slack_message":
      return t("summary.slack");
    case "propose_follow_up":
      return t("summary.followUp", { title: action.title });
    case "reschedule_commitment":
      return t("summary.reschedule", { title: action.title });
    default:
      return t("summary.generic");
  }
}

const runtimeErrorKeys: Record<string, MessageKey> = {
  "Email changes run only after explicit approval.": "approval.emailGate",
  "Calendar deletes run only after explicit approval.": "approval.calendarDeleteGate",
  "Calendar reschedules run only after explicit approval.": "approval.calendarRescheduleGate",
  "The approved action could not be completed.": "approval.failed",
};

export function localizedRuntimeMessage(message: string, t: Translate): string {
  const key = runtimeErrorKeys[message];
  return key ? t(key) : message;
}
