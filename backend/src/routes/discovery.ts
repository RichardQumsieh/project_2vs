import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { personLikePattern, rankPeople } from "../people-lookup.js";
import { Prisma } from "@prisma/client";
import { updateAvatarSchema } from "../avatar.js";
import { updateProfileSchema, userLookupQuery } from "../schemas.js";
import { publicUser } from "../util.js";

type RecommendedUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarConfig: unknown;
  greetingText: string | null;
  greetingAnimation: string | null;
  interests: string[];
  sharedInterestCount: number;
};

export async function discoveryRoutes(app: FastifyInstance) {
  app.patch(
    "/me/profile",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const parsed = updateProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid profile interests" });
      }

      const user = await prisma.user.update({
        where: { id: session.sub },
        data: { interests: parsed.data.interests },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          interests: true,
        },
      });

      reply.header("Cache-Control", "no-store");
      return { user };
    },
  );

  app.patch(
    "/me/avatar",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      const parsed = updateAvatarSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid avatar" });
      }
      const user = await prisma.user.update({
        where: { id: session.sub },
        data: {
          avatarConfig: parsed.data.avatarConfig === null ? Prisma.DbNull : parsed.data.avatarConfig,
          greetingText: parsed.data.greetingText && parsed.data.greetingText.length > 0
            ? parsed.data.greetingText
            : null,
          greetingAnimation: parsed.data.greetingAnimation,
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          avatarConfig: true,
          greetingText: true,
          greetingAnimation: true,
        },
      });
      reply.header("Cache-Control", "no-store");
      return { user: publicUser(user) };
    },
  );

  app.get(
    "/users/lookup",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      const parsed = userLookupQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid search" });
      const pattern = personLikePattern(parsed.data.q);
      if (!pattern) return reply.code(400).send({ error: "Invalid search" });
      const rows = await prisma.$queryRaw<Array<{
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
        avatarConfig: unknown;
        greetingText: string | null;
        greetingAnimation: string | null;
      }>>`
        SELECT "id", "username", "displayName", "avatarUrl", "avatarConfig", "greetingText", "greetingAnimation"
        FROM "User"
        WHERE "id" <> ${session.sub}
          AND (
            lower("username") LIKE ${pattern} ESCAPE '\\'
            OR lower(coalesce("displayName", '')) LIKE ${pattern} ESCAPE '\\'
          )
        ORDER BY "username" ASC
        LIMIT 20
      `;
      reply.header("Cache-Control", "no-store");
      return {
        users: rankPeople(rows, parsed.data.q).slice(0, 8).map((user) => publicUser(user)),
      };
    },
  );

  app.get(
    "/users/recommendations",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const currentUser = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { interests: true },
      });
      if (!currentUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      if (currentUser.interests.length === 0) {
        reply.header("Cache-Control", "no-store");
        return { users: [] };
      }

      const users = await prisma.$queryRaw<RecommendedUser[]>`
        SELECT
          candidate."id",
          candidate."username",
          candidate."displayName",
          candidate."avatarUrl",
          candidate."avatarConfig",
          candidate."greetingText",
          candidate."greetingAnimation",
          candidate."interests",
          (
            SELECT COUNT(*)::int
            FROM unnest(candidate."interests") AS candidate_interest(value)
            WHERE candidate_interest.value = ANY(${currentUser.interests}::text[])
          ) AS "sharedInterestCount"
        FROM "User" AS candidate
        WHERE candidate."id" <> ${session.sub}
          AND candidate."interests" && ${currentUser.interests}::text[]
          AND NOT EXISTS (
            SELECT 1
            FROM "ConversationMember" AS own_membership
            INNER JOIN "ConversationMember" AS other_membership
              ON other_membership."conversationId" = own_membership."conversationId"
            WHERE own_membership."userId" = ${session.sub}
              AND other_membership."userId" = candidate."id"
          )
        ORDER BY "sharedInterestCount" DESC, candidate."createdAt" DESC, candidate."id" ASC
        LIMIT 20
      `;

      reply.header("Cache-Control", "no-store");
      return {
        users: users.map((user) => ({
          ...publicUser(user),
          interests: user.interests,
          sharedInterestCount: user.sharedInterestCount,
        })),
      };
    },
  );
}
