export type BriefLanguage = "en" | "ar";

export type BriefPreference = {
  briefTime: string;
  language: BriefLanguage;
  timeZone: string;
};

export type BriefMeeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  prepNote: string;
  conflictsWith: string[];
};

export type BriefReply = {
  id: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  urgency: "high" | "medium" | "low";
  reason: string;
};

export type BriefFollowUp = {
  id: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  daysOverdue: number;
};

export type BriefApproval =
  | {
      action: "save_draft";
      provider: "gmail" | "outlook-mail";
      idempotencyKey: string;
      payload: { to: string[]; subject: string; body: string };
    }
  | {
      action: "reschedule_event";
      provider: "google" | "outlook";
      idempotencyKey: string;
      payload: {
        externalEventId: string;
        title: string;
        startsAt: string;
        endsAt: string;
        allDay?: boolean;
      };
    }
  | {
      action: "delete_event";
      provider: "google" | "outlook";
      idempotencyKey: string;
      payload: { eventId: string };
    };

export type BriefSuggestedAction = {
  id: string;
  kind: "draft_reply" | "reschedule" | "decline";
  title: string;
  detail: string;
  approvalRequired: true;
  approval: BriefApproval;
};

export type DailyBriefDocument = {
  localDate: string;
  timeZone: string;
  language: BriefLanguage;
  generatedAt: string;
  source: "morning" | "on_demand";
  mode: "mock" | "live";
  narrative: string;
  meetings: BriefMeeting[];
  needsReply: BriefReply[];
  overdueFollowUps: BriefFollowUp[];
  actions: BriefSuggestedAction[];
};

export type BriefPendingReason = "before_brief_time" | "not_connected";

export type DailyBriefResponse = {
  enabled: true;
  preference: BriefPreference;
  brief: DailyBriefDocument | null;
  pendingReason: BriefPendingReason | null;
};
