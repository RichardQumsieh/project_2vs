import type { IntegrationProvider } from "@prisma/client";
import { prisma } from "./db.js";
import {
  defaultBriefPreference,
  localDayBounds,
  zonedParts,
  type BriefPreference,
  type BriefSource,
  type DailyBriefDocument,
} from "./daily-brief.js";
import type { DailyBriefRepository, StoredBrief } from "./daily-brief-service.js";

const calendarProviders: IntegrationProvider[] = ["GOOGLE_CALENDAR", "OUTLOOK_CALENDAR"];
const mailProviders: IntegrationProvider[] = ["GMAIL", "OUTLOOK_MAIL"];

function calendarProvider(provider: IntegrationProvider): "google" | "outlook" | null {
  if (provider === "GOOGLE_CALENDAR") return "google";
  if (provider === "OUTLOOK_CALENDAR") return "outlook";
  return null;
}

function mailProvider(provider: IntegrationProvider): "gmail" | "outlook-mail" | null {
  if (provider === "GMAIL") return "gmail";
  if (provider === "OUTLOOK_MAIL") return "outlook-mail";
  return null;
}

function preferenceFromRow(row: { briefTime: string; language: string; timeZone: string }): BriefPreference {
  const language = row.language === "ar" ? "ar" : "en";
  return {
    briefTime: row.briefTime,
    language,
    timeZone: row.timeZone || defaultBriefPreference().timeZone,
  };
}

function isDocument(value: unknown): value is DailyBriefDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<DailyBriefDocument>;
  return typeof row.narrative === "string"
    && Array.isArray(row.meetings)
    && Array.isArray(row.needsReply)
    && Array.isArray(row.overdueFollowUps)
    && Array.isArray(row.actions);
}

export function createPrismaDailyBriefRepository(): DailyBriefRepository {
  return {
    async getPreference(userId) {
      const row = await prisma.dailyBriefPreference.findUnique({ where: { userId } });
      return row ? preferenceFromRow(row) : null;
    },

    async savePreference(userId, preference) {
      const row = await prisma.dailyBriefPreference.upsert({
        where: { userId },
        create: { userId, ...preference },
        update: preference,
      });
      return preferenceFromRow(row);
    },

    async findBrief(userId, localDate) {
      const row = await prisma.dailyBrief.findUnique({
        where: { ownerUserId_localDate: { ownerUserId: userId, localDate } },
      });
      if (!row || !isDocument(row.document)) return null;
      return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        localDate: row.localDate,
        document: row.document,
      } satisfies StoredBrief;
    },

    async saveBrief(input) {
      const row = await prisma.dailyBrief.upsert({
        where: {
          ownerUserId_localDate: {
            ownerUserId: input.ownerUserId,
            localDate: input.localDate,
          },
        },
        create: {
          ownerUserId: input.ownerUserId,
          localDate: input.localDate,
          language: input.document.language,
          timeZone: input.document.timeZone,
          source: input.document.source,
          mode: input.document.mode,
          document: input.document,
          generatedAt: new Date(input.document.generatedAt),
        },
        update: {
          language: input.document.language,
          timeZone: input.document.timeZone,
          source: input.document.source,
          mode: input.document.mode,
          document: input.document,
          generatedAt: new Date(input.document.generatedAt),
        },
      });
      return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        localDate: row.localDate,
        document: input.document,
      };
    },

    async listCandidates() {
      const [preferences, connections] = await Promise.all([
        prisma.dailyBriefPreference.findMany({ take: 500 }),
        prisma.integrationConnection.findMany({
          where: {
            status: "CONNECTED",
            provider: { in: [...calendarProviders, ...mailProviders] },
          },
          select: { ownerUserId: true },
          distinct: ["ownerUserId"],
          take: 500,
        }),
      ]);
      const byUser = new Map<string, BriefPreference>();
      for (const row of preferences) byUser.set(row.userId, preferenceFromRow(row));
      for (const row of connections) {
        if (!byUser.has(row.ownerUserId)) byUser.set(row.ownerUserId, defaultBriefPreference());
      }
      return [...byUser.entries()].map(([userId, preference]) => ({ userId, preference }));
    },

    async loadSources(userId, now, preference): Promise<BriefSource> {
      const local = zonedParts(now, preference.timeZone);
      const bounds = localDayBounds(local.date, preference.timeZone);
      const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const [events, messages, connected] = await Promise.all([
        prisma.calendarEventMirror.findMany({
          where: {
            ownerUserId: userId,
            startsAt: { lt: bounds.end },
            endsAt: { gt: bounds.start },
            connection: { status: "CONNECTED", provider: { in: calendarProviders } },
          },
          include: { connection: { select: { provider: true } } },
          orderBy: { startsAt: "asc" },
          take: 40,
        }),
        prisma.mailMessageMirror.findMany({
          where: {
            ownerUserId: userId,
            receivedAt: { gte: since },
            connection: { status: "CONNECTED", provider: { in: mailProviders } },
          },
          include: { connection: { select: { provider: true } } },
          orderBy: { receivedAt: "desc" },
          take: 40,
        }),
        prisma.integrationConnection.findMany({
          where: {
            ownerUserId: userId,
            status: "CONNECTED",
            provider: { in: [...calendarProviders, ...mailProviders] },
          },
          select: { provider: true },
        }),
      ]);
      const connections = {
        mail: connected.some((row) => mailProvider(row.provider) !== null),
        calendar: connected.some((row) => calendarProvider(row.provider) !== null),
      };
      return {
        connections,
        calendar: connections.calendar ? events.flatMap((event) => {
          const provider = calendarProvider(event.connection.provider);
          if (!provider) return [];
          return [{
            id: event.id,
            externalEventId: event.externalEventId,
            provider,
            title: event.title,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            allDay: event.allDay,
            busy: event.busy,
          }];
        }) : [],
        mail: connections.mail ? messages.flatMap((message) => {
          const provider = mailProvider(message.connection.provider);
          if (!provider) return [];
          return [{
            id: message.id,
            provider,
            fromAddress: message.fromAddress,
            subject: message.subject,
            snippet: message.snippet,
            receivedAt: message.receivedAt.toISOString(),
          }];
        }) : [],
      };
    },
  };
}
