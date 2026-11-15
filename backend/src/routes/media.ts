import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { b2Configured } from "../env.js";
import {
  applyBucketCors,
  createMediaDownloadUrl,
  createMediaUploadUrl,
} from "../media-storage.js";

import {
  createMediaUploadSchema,
  mediaIdParamSchema,
} from "../schemas.js";

let bucketCorsPromise: Promise<void> | null = null;

async function ensureBucketCors() {
  if (!bucketCorsPromise) {
    bucketCorsPromise = applyBucketCors().catch((error: unknown) => {
      bucketCorsPromise = null;
      throw error;
    });
  }
  await bucketCorsPromise;
}

async function requireConversationMember(
  conversationId: string,
  userId: string,
) {
  return prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  });
}

export async function mediaRoutes(app: FastifyInstance) {
  app.post(
    "/conversations/:id/media",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      if (!b2Configured) {
        return reply.code(503).send({
          error: "Media storage is not configured on this server.",
        });
      }

      const { id } = request.params as { id: string };
      const parsed = createMediaUploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid media upload" });
      }

      const member = await requireConversationMember(id, session.sub);
      if (!member) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const mediaId = randomUUID();
      const objectKey = `media/${randomUUID()}`;
      await ensureBucketCors();
      const uploadUrl = await createMediaUploadUrl(
        objectKey,
        parsed.data.byteSize,
      );
      await prisma.mediaObject.create({
        data: {
          id: mediaId,
          conversationId: id,
          uploaderUserId: session.sub,
          objectKey,
          byteSize: parsed.data.byteSize,
        },
      });

      return {
        mediaId,
        uploadUrl,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      };
    },
  );

  app.post(
    "/conversations/:id/media/:mediaId/download",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      if (!b2Configured) {
        return reply.code(503).send({
          error: "Media storage is not configured on this server.",
        });
      }

      const { id } = request.params as { id: string };
      const parsedParams = mediaIdParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: "Invalid media" });
      }

      const member = await requireConversationMember(id, session.sub);
      if (!member) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const media = await prisma.mediaObject.findFirst({
        where: {
          id: parsedParams.data.mediaId,
          conversationId: id,
        },
      });
      if (!media) {
        return reply.code(404).send({ error: "Media not found" });
      }

      const downloadUrl = await createMediaDownloadUrl(media.objectKey);
      return { downloadUrl };
    },
  );
}
