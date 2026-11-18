import type { AgentToolAction } from "./agent-runtime";
import type { RadarBriefing } from "./radar-briefing";
import type { RadarFinding, RadarStoreState, RadarTaskDraft } from "./radar-store";

export const JOB_MANAGER_TOOLS = [
  "draft_email",
  "create_calendar_event",
  "delete_calendar_event",
  "create_github_issue",
  "create_linear_issue",
  "post_slack_message",
  "propose_follow_up",
  "reschedule_commitment",
] as const;

export type JobManagerTool = (typeof JOB_MANAGER_TOOLS)[number];

export function isJobManagerTool(
  type: string,
): type is JobManagerTool {
  return (JOB_MANAGER_TOOLS as readonly string[]).includes(type);
}

export type JobManagerDefaults = {
  calendarProvider?: "google" | "outlook";
  emailProvider?: "gmail" | "outlook-mail";
  githubOwner?: string;
  githubRepo?: string;
  linearTeamId?: string;
  slackChannelId?: string;
  slackChannelName?: string;
};

function parseDueMs(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(
    value.length <= 10 ? `${value}T12:00:00.000Z` : value,
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function openTasks(
  state: RadarStoreState,
  conversationId?: string | null,
) {
  return state.taskDrafts.filter((draft) => {
    if (draft.status !== "open") {
      return false;
    }
    if (
      conversationId &&
      draft.conversationId &&
      draft.conversationId !== conversationId
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Proactive deadline proposals from Radar + accepted drafts.
 * Never auto-executes — caller must stage via agent-runtime.propose.
 */
export function buildDeadlineProposals(
  state: RadarStoreState,
  options: {
    now?: Date;
    conversationId?: string | null;
    withinDays?: number;
    maxProposals?: number;
  } = {},
): AgentToolAction[] {
  const now = options.now ?? new Date();
  const withinDays = options.withinDays ?? 3;
  const maxProposals = options.maxProposals ?? 4;
  const end = now.getTime() + withinDays * 24 * 60 * 60 * 1000;
  const tasks = openTasks(state, options.conversationId);
  const actions: AgentToolAction[] = [];

  const dueSoonOrOverdue = tasks
    .map((task) => ({ task, due: parseDueMs(task.dueAt) }))
    .filter(
      (row): row is { task: RadarTaskDraft; due: number } =>
        row.due !== null && row.due <= end,
    )
    .sort((a, b) => a.due - b.due);

  for (const { task, due } of dueSoonOrOverdue) {
    if (actions.length >= maxProposals) {
      break;
    }
    const overdue = due < now.getTime();
    if (overdue) {
      const push = new Date(now);
      push.setDate(push.getDate() + 1);
      actions.push({
        type: "reschedule_commitment",
        taskDraftId: task.id,
        title: task.title,
        dueAt: push.toISOString().slice(0, 10),
        previousDueAt: task.dueAt,
      });
    } else {
      actions.push({
        type: "propose_follow_up",
        title: `Follow up: ${task.title}`.slice(0, 160),
        dueAt: task.dueAt,
        conversationId: task.conversationId,
        sourceFindingId: task.findingId,
        notes: "Staged from Radar deadline scan (on-device).",
      });
    }
  }

  return actions;
}

/**
 * Secondary Radar → action proposals after Accept (calendar / GitHub / Linear).
 * Prefills from finding context; user still must approve each write.
 */
export function buildRadarSecondaryActions(
  finding: RadarFinding,
  defaults: JobManagerDefaults = {},
  now = new Date(),
): AgentToolAction[] {
  const title = finding.title.trim().slice(0, 160) || "Radar commitment";
  const dueDay =
    finding.dueAt?.slice(0, 10) ||
    (() => {
      const day = new Date(now);
      day.setDate(day.getDate() + 1);
      return day.toISOString().slice(0, 10);
    })();
  const startsAt = `${dueDay}T15:00:00.000Z`;
  const endsAt = `${dueDay}T15:30:00.000Z`;
  const body = [
    finding.excerpt?.trim(),
    finding.dueAt ? `Due: ${finding.dueAt.slice(0, 10)}` : null,
    "Staged from Commitment Radar (on-device). No chat plaintext left this device for drafting.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);

  const actions: AgentToolAction[] = [
    {
      type: "create_calendar_event",
      provider: defaults.calendarProvider ?? "google",
      title: title.slice(0, 200),
      startsAt,
      endsAt,
      description: body.slice(0, 4_000),
    },
  ];

  if (defaults.githubOwner && defaults.githubRepo) {
    actions.push({
      type: "create_github_issue",
      owner: defaults.githubOwner,
      repo: defaults.githubRepo,
      title,
      body,
    });
  }

  if (defaults.linearTeamId) {
    actions.push({
      type: "create_linear_issue",
      title,
      teamId: defaults.linearTeamId,
      description: body,
    });
  }

  return actions;
}

/**
 * Map a briefing line / due-soon task into a staged chat action.
 */
export function buildBriefingStagedAction(
  briefing: RadarBriefing,
  options: {
    task?: RadarTaskDraft;
    kind?: "follow_up" | "reschedule";
    now?: Date;
  } = {},
): AgentToolAction | null {
  const task = options.task;
  if (!task) {
    if (!briefing.dueSoonCount && !briefing.pendingCount) {
      return null;
    }
    return {
      type: "propose_follow_up",
      title: "Review Radar briefing items",
      notes: briefing.lines.slice(0, 4).join(" · ").slice(0, 500),
    };
  }
  const now = options.now ?? new Date();
  const due = parseDueMs(task.dueAt);
  const overdue = due !== null && due < now.getTime();
  if (options.kind === "reschedule" || overdue) {
    const push = new Date(now);
    push.setDate(push.getDate() + 1);
    return {
      type: "reschedule_commitment",
      taskDraftId: task.id,
      title: task.title,
      dueAt: push.toISOString().slice(0, 10),
      previousDueAt: task.dueAt,
    };
  }
  return {
    type: "propose_follow_up",
    title: `Follow up: ${task.title}`.slice(0, 160),
    dueAt: task.dueAt,
    conversationId: task.conversationId,
    sourceFindingId: task.findingId,
    notes: "Staged from daily briefing (on-device).",
  };
}

export function parseGithubRepoRef(text: string) {
  const match = text.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  if (/^(https?|mailto)$/i.test(match[1])) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export function parseEmailAddresses(text: string) {
  return [
    ...text.matchAll(
      /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    ),
  ]
    .map((match) => match[1])
    .filter((address, index, all) => all.indexOf(address) === index)
    .slice(0, 8);
}

export function parseSlackChannelHint(text: string) {
  const match = text.match(/#([A-Za-z0-9_-]{1,80})\b/);
  return match?.[1] ?? null;
}

export function parseDurationMinutes(text: string) {
  const match = text.match(/\b(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i);
  if (!match?.[1] || !match[2]) {
    return 30;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 30;
  }
  return /h/i.test(match[2]) ? Math.min(480, amount * 60) : Math.min(480, amount);
}

export function defaultEventWindow(
  dayIso: string | undefined,
  minutes: number,
  now: Date,
) {
  const day =
    dayIso ??
    (() => {
      const next = new Date(now);
      next.setUTCDate(next.getUTCDate() + ((1 + 7 - next.getUTCDay()) % 7 || 7));
      return next.toISOString().slice(0, 10);
    })();
  const startsAt = `${day}T16:00:00.000Z`;
  const ends = new Date(Date.parse(startsAt) + minutes * 60_000);
  return {
    startsAt,
    endsAt: ends.toISOString(),
  };
}
