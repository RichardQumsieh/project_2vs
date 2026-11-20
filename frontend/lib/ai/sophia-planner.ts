import {
  buildMeetingAgendaDocument,
  buildPresentationDocument,
  buildResearchBriefDocument,
  type SophiaDocument,
} from "./sophia-documents";
import { composeMeetingDraft, type VoicePreferences } from "../appearance/voice";
import type { MemoryFact } from "./personal-memory";
import { answerRadarQuestion } from "./radar-briefing";
import type { RadarStoreState } from "./radar-store";
import {
  defaultEventWindow,
  parseDurationMinutes,
  parseEmailAddresses,
  parseGithubRepoRef,
  parseSlackChannelHint,
  type JobManagerDefaults,
} from "./sophia-job-tools";

export type SophiaIntent =
  | {
      type: "create_document";
      document: SophiaDocument;
    }
  | {
      type: "research";
      query: string;
    }
  | {
      type: "draft_message";
      body: string;
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
      type: "radar_answer";
      text: string;
    }
  | {
      type: "draft_email";
      provider: "gmail" | "outlook-mail";
      to: string[];
      subject: string;
      body: string;
      cc?: string[];
      delivery?: "send" | "draft";
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
      teamId?: string;
      description?: string;
    }
  | {
      type: "post_slack_message";
      channelId?: string;
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
    };

export type SophiaPlan = {
  addressedToSophia: boolean;
  intents: SophiaIntent[];
  spokenReply: string;
};

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const commandCue =
  /\b(prepare|create|draft|write|make|research|look up|search|organize|schedule|set up|book|file|open|post|remind|follow[\s-]?up|reschedule|push|remember|forget|outstanding|promise[d]?|briefing|what's left|what is left|linear|github|slack|email|calendar)\b/i;

export function stripSophiaWakeWord(input: string) {
  return input
    .replace(/@?(?:sophia|jarvis)\b/gi, " ")
    .replace(
      /\b(?:hey |ok |okay |hi )?(?:sophia|jarvis)\b|,?\s*(?:sophia|jarvis)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function isSophiaAddressed(input: string) {
  return (
    /(?:^|[\s,])@?(?:sophia|jarvis)\b/i.test(input) ||
    /\b(?:hey |ok |okay |hi )?(?:sophia|jarvis)\b/i.test(input)
  );
}

function nextWeekday(now: Date, weekday: (typeof weekdays)[number]) {
  const target = weekdays.indexOf(weekday);
  const current = now.getDay();
  const daysAhead = (target - current + 7) % 7 || 7;
  const date = new Date(now);
  date.setDate(now.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

export function resolveRelativeDate(text: string, now: Date) {
  const match = text.match(
    /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (!match?.[1]) {
    return undefined;
  }
  const weekday = match[1].toLowerCase() as (typeof weekdays)[number];
  return nextWeekday(now, weekday);
}

function extractQuotedNames(text: string) {
  return [...text.matchAll(/"([^"]{1,80})"/g)].map((match) => match[1].trim());
}

function extractCompetitorNames(text: string) {
  const listed = text.match(
    /competitors?\s+(?:named\s+)?([A-Za-z0-9&.,\s-]{3,120})/i,
  );
  if (!listed?.[1] || /three|several|some|our/i.test(listed[1])) {
    return extractQuotedNames(text);
  }
  return listed[1]
    .split(/\s*(?:,|and|&)\s*/)
    .map((name) => name.replace(/\.$/, "").trim())
    .filter((name) => name.length > 1 && !/^(the|team|market)$/i.test(name));
}

function memoryHint(memories: MemoryFact[], pattern: RegExp) {
  return memories.find((fact) => pattern.test(fact.text))?.text;
}

function findOpenTaskForReschedule(store: RadarStoreState | null | undefined, text: string) {
  if (!store) {
    return null;
  }
  const open = store.taskDrafts.filter((draft) => draft.status === "open");
  if (!open.length) {
    return null;
  }
  const lowered = text.toLowerCase();
  const matched = open.find((draft) =>
    draft.title
      .toLowerCase()
      .split(/\s+/)
      .some((token) => token.length > 3 && lowered.includes(token)),
  );
  return matched ?? open[0] ?? null;
}

function extractWithPerson(text: string) {
  const match = text.match(
    /\b(?:with|for)\s+@?([A-Za-z][A-Za-z0-9_.-]{1,40})\b/i,
  );
  return match?.[1] ?? null;
}

export function parseSophiaCommand(
  input: string,
  options: {
    memories?: MemoryFact[];
    recipientUsername?: string | null;
    now?: Date;
    radarStore?: RadarStoreState | null;
    conversationId?: string | null;
    jobDefaults?: JobManagerDefaults;
    voice?: VoicePreferences;
  } = {},
): SophiaPlan {
  const raw = input.replace(/\u0000/g, "").trim();
  const addressedToSophia = isSophiaAddressed(raw);
  const text = stripSophiaWakeWord(raw);
  if (!text || text.length > 2_000) {
    return { addressedToSophia, intents: [], spokenReply: "" };
  }
  if (!addressedToSophia && !commandCue.test(text)) {
    return { addressedToSophia, intents: [], spokenReply: "" };
  }

  const now = options.now ?? new Date();
  const memories = options.memories ?? [];
  const defaults = options.jobDefaults ?? {};
  const intents: SophiaIntent[] = [];
  const summaries: string[] = [];
  const due = resolveRelativeDate(text, now);
  const recipient = options.recipientUsername
    ? `@${options.recipientUsername}`
    : "the selected chat";
  const wantsPresentation =
    /\b(presentation|slides|slide deck|deck|pptx)\b/i.test(text);
  const wantsResearch =
    /\b(research|look up|search)\b/i.test(text) ||
    /\bcompetitors?\b/i.test(text);
  const wantsMeeting =
    /\borganize a meeting\b/i.test(text) ||
    (/\b(meeting|huddle|sync|standup)\b/i.test(text) &&
      /\b(organize|schedule|set up|arrange|book)\b/i.test(text));
  const wantsCalendarHold =
    /\b(schedule|book|hold|block)\b/i.test(text) &&
    (/\b(\d{1,3}\s*(m|min|mins|minutes|h|hr|hrs|hours)|calendar|with\s+\w+)\b/i.test(
      text,
    ) ||
      Boolean(due));
  const wantsEmailSend =
    /\bsend\b.+\b(e-?mail)\b/i.test(text) ||
    /\b(e-?mail)\b.+\bsend\b/i.test(text);
  const wantsEmailDraft =
    !wantsEmailSend &&
    (/\b(draft|write|compose)\b.+\b(email|e-mail)\b/i.test(text) ||
      /\bemail\b.+\b(draft|to)\b/i.test(text));
  const wantsGithubIssue =
    /\b(file|create|open)\b.+\b(github\s+)?issue\b/i.test(text) ||
    /\bgithub\b.+\b(issue|ticket)\b/i.test(text);
  const wantsLinearIssue =
    /\b(file|create|open)\b.+\blinear\b/i.test(text) ||
    /\blinear\b.+\b(issue|ticket)\b/i.test(text);
  const wantsSlackPost =
    /\b(draft|post|send|summariz(?:e|ing))\b.+\bslack\b/i.test(text) ||
    /\bslack\b.+\b(#|to|channel|summar)/i.test(text);
  const wantsFollowUp =
    /\b(follow[\s-]?up(?:\s+on)?|remind me(?:\s+to)?|nudge)\b/i.test(text) &&
    !wantsGithubIssue &&
    !wantsLinearIssue &&
    !wantsEmailDraft &&
    !wantsEmailSend &&
    !wantsSlackPost &&
    !wantsCalendarHold;
  const wantsReschedule =
    /\b(reschedule|push(?:\s+the)?\s+due|move(?:\s+the)?\s+deadline|defer)\b/i.test(
      text,
    );
  const rememberMatch = text.match(/\bremember(?: that)?\s+(.{3,240})$/i);
  const forgetMatch = text.match(/\bforget(?: that)?\s+(.{3,240})$/i);
  const jobManagerIntent =
    wantsCalendarHold ||
    wantsEmailDraft ||
    wantsEmailSend ||
    wantsGithubIssue ||
    wantsLinearIssue ||
    wantsSlackPost ||
    wantsFollowUp ||
    wantsReschedule;
  const explicitMemoryOnly =
    Boolean(rememberMatch || forgetMatch) &&
    !wantsPresentation &&
    !wantsResearch &&
    !wantsMeeting &&
    !jobManagerIntent;

  if (
    options.radarStore &&
    !explicitMemoryOnly &&
    !wantsPresentation &&
    !wantsResearch &&
    !wantsMeeting &&
    !jobManagerIntent
  ) {
    const radarAnswer = answerRadarQuestion(text, options.radarStore, {
      now,
      conversationId: options.conversationId,
      peerUsername: options.recipientUsername,
    });
    if (radarAnswer) {
      return {
        addressedToSophia,
        intents: [{ type: "radar_answer", text: radarAnswer }],
        spokenReply: radarAnswer,
      };
    }
  }

  if (explicitMemoryOnly && rememberMatch?.[1]) {
    intents.push({ type: "remember_fact", fact: rememberMatch[1].trim() });
    summaries.push("store a personal note");
  } else if (explicitMemoryOnly && forgetMatch?.[1]) {
    intents.push({ type: "forget_fact", query: forgetMatch[1].trim() });
    summaries.push("remove a personal note");
  }

  if (!explicitMemoryOnly && (wantsEmailDraft || wantsEmailSend)) {
    const to = parseEmailAddresses(text);
    if (to.length) {
      const subjectMatch = text.match(
        /\b(?:about|subject|re)\s+(.{3,120})$/i,
      );
      const subject =
        subjectMatch?.[1]?.trim().replace(/[.?]$/, "").slice(0, 200) ||
        "Follow-up";
      intents.push({
        type: "draft_email",
        provider: defaults.emailProvider ?? "gmail",
        to,
        subject,
        body: text.slice(0, 4_000),
        delivery: wantsEmailSend ? "send" : "draft",
      });
      summaries.push(
        wantsEmailSend ? "stage an email to send" : "stage an email draft",
      );
    }
  }

  if (!explicitMemoryOnly && wantsCalendarHold) {
    const minutes = parseDurationMinutes(text);
    const person = extractWithPerson(text);
    const window = defaultEventWindow(due, minutes, now);
    const title = person ? `${minutes}m with ${person}` : "Scheduled hold";
    intents.push({
      type: "create_calendar_event",
      provider: defaults.calendarProvider ?? "google",
      title: title.slice(0, 200),
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      description: text.slice(0, 4_000),
    });
    summaries.push("stage a calendar event");
  }

  if (!explicitMemoryOnly && wantsGithubIssue) {
    const repo =
      parseGithubRepoRef(text) ??
      (defaults.githubOwner && defaults.githubRepo
        ? { owner: defaults.githubOwner, repo: defaults.githubRepo }
        : null);
    if (repo) {
      const titleMatch = text.match(
        /\b(?:issue|ticket)\b(?:\s+(?:for|about|on))?\s+(.{3,120})$/i,
      );
      intents.push({
        type: "create_github_issue",
        owner: repo.owner,
        repo: repo.repo,
        title: (titleMatch?.[1] ?? text).trim().slice(0, 256),
        body: text.slice(0, 4_000),
      });
      summaries.push(`stage a GitHub issue in ${repo.owner}/${repo.repo}`);
    }
  }

  if (!explicitMemoryOnly && wantsLinearIssue) {
    const titleMatch = text.match(
      /\b(?:linear|ticket|issue)\b(?:\s+(?:for|about|on))?\s+(.{3,120})$/i,
    );
    intents.push({
      type: "create_linear_issue",
      title: (titleMatch?.[1] ?? text).trim().slice(0, 256),
      teamId: defaults.linearTeamId?.trim() || undefined,
      description: text.slice(0, 4_000),
    });
    summaries.push("stage a Linear issue");
  }

  if (!explicitMemoryOnly && wantsSlackPost) {
    const channelHint = parseSlackChannelHint(text);
    const summarizing = text.match(
      /\bsummariz(?:e|ing)\b[:\s]+(.{3,500})$/i,
    );
    intents.push({
      type: "post_slack_message",
      channelId: defaults.slackChannelId?.trim() || undefined,
      channelName: channelHint ?? defaults.slackChannelName,
      text: (summarizing?.[1] ?? text).trim().slice(0, 4_000),
    });
    summaries.push(
      `stage a Slack post${
        channelHint || defaults.slackChannelName
          ? ` to #${channelHint ?? defaults.slackChannelName}`
          : ""
      }`,
    );
  }

  if (!explicitMemoryOnly && wantsFollowUp) {
    const titleMatch = text.match(
      /\b(?:follow[\s-]?up(?:\s+on)?|remind me(?:\s+to)?|nudge)\s+(.{3,160})$/i,
    );
    intents.push({
      type: "propose_follow_up",
      title: (titleMatch?.[1] ?? text).trim().slice(0, 160),
      dueAt: due,
      conversationId: options.conversationId ?? undefined,
      notes: "Staged from Sophia command (on-device).",
    });
    summaries.push("stage a follow-up reminder");
  }

  if (!explicitMemoryOnly && wantsReschedule) {
    const task = findOpenTaskForReschedule(options.radarStore, text);
    if (task) {
      intents.push({
        type: "reschedule_commitment",
        taskDraftId: task.id,
        title: task.title,
        dueAt: due ?? (() => {
          const push = new Date(now);
          push.setDate(push.getDate() + 1);
          return push.toISOString().slice(0, 10);
        })(),
        previousDueAt: task.dueAt,
      });
      summaries.push("stage a reschedule");
    }
  }

  if (!explicitMemoryOnly && wantsPresentation) {
    const audienceMatch = text.match(
      /\b(?:presentation|slides|slide deck|deck|pptx)\b(?:[^.]{0,80}?)\b(?:for|to)\s+(?:my\s+)?([A-Za-z][A-Za-z-]{1,40})\b/i,
    );
    const audience = audienceMatch?.[1]?.trim();
    const title = audience
      ? `Presentation for ${audience}`
      : "Presentation outline";
    const document = buildPresentationDocument({
      title,
      audience,
      due,
      notes: text,
    });
    intents.push({ type: "create_document", document });
    intents.push({
      type: "remember_fact",
      fact: due ? `${title} is due ${due}` : `${title} is in progress`,
    });
    summaries.push(`prepare ${document.filename}`);
  }

  if (!explicitMemoryOnly && wantsResearch) {
    const named = extractCompetitorNames(text);
    const countMatch = text.match(/\b(\d+|three|two|four)\s+competitors?\b/i);
    const count =
      countMatch?.[1] === "two"
        ? 2
        : countMatch?.[1] === "three"
          ? 3
          : countMatch?.[1] === "four"
            ? 4
            : Number(countMatch?.[1] || named.length || 3);
    const subjects =
      named.length > 0
        ? named.slice(0, Math.min(4, count))
        : Array.from(
            { length: Math.min(4, Math.max(1, count)) },
            (_, index) => `Competitor ${index + 1}`,
          );
    const industry =
      memoryHint(memories, /\b(industry|company|product|market)\b/i) ??
      "the relevant market";
    const query = named.length
      ? `${named.join(" vs ")} competitors overview`
      : `${subjects.length} competitors ${industry}`.slice(0, 300);
    intents.push({ type: "research", query: query.slice(0, 300) });
    intents.push({
      type: "create_document",
      document: buildResearchBriefDocument({
        title: "Competitor research brief",
        subjects,
        query,
      }),
    });
    summaries.push("stage competitor research and a brief");
  }

  if (!explicitMemoryOnly && wantsMeeting) {
    const when = due ?? "a time the team can do";
    const purpose = wantsPresentation
      ? "prepare the manager presentation"
      : "align on next steps";
    const agenda = buildMeetingAgendaDocument({
      title: "Team meeting agenda",
      when,
      attendees: "the team",
      purpose,
    });
    const draft = composeMeetingDraft({ purpose, when, voice: options.voice });
    intents.push({ type: "create_document", document: agenda });
    intents.push({ type: "draft_message", body: draft.slice(0, 4_000) });
    summaries.push(`draft a meeting note for ${recipient}`);
  }

  if (
    !intents.length &&
    /\b(create|write|draft|make)\b.+\b(doc|document|note|brief|agenda)\b/i.test(
      text,
    )
  ) {
    const document = buildPresentationDocument({
      title: text.slice(0, 80),
      notes: text,
      due,
    });
    document.kind = "notes";
    intents.push({ type: "create_document", document });
    summaries.push(`create ${document.filename}`);
  }

  const unique: SophiaIntent[] = [];
  const seen = new Set<string>();
  for (const intent of intents.slice(0, 8)) {
    const key = JSON.stringify(intent);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(intent);
  }

  if (!unique.length) {
    const missingProviderHint = jobManagerIntent
      ? " Connect the related provider (and set repo/team/channel defaults from mirrors) so I can stage that write."
      : "";
    return {
      addressedToSophia,
      intents: [],
      spokenReply: addressedToSophia
        ? `I'm here. Ask what's outstanding, schedule a hold, draft email/Slack, file GitHub/Linear, follow up, reschedule, or give me a presentation/research/meeting task.${missingProviderHint}`
        : "",
    };
  }

  const actionable = unique.filter((intent) => intent.type !== "radar_answer");
  if (!actionable.length) {
    const answer = unique.find((intent) => intent.type === "radar_answer");
    return {
      addressedToSophia,
      intents: unique,
      spokenReply:
        answer && answer.type === "radar_answer"
          ? answer.text
          : "I checked authorized Radar context on this device.",
    };
  }

  return {
    addressedToSophia,
    intents: unique,
    spokenReply: `On it. I staged ${summaries.join(", ")}. None of this runs until you approve each action.`,
  };
}
