import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { denyUnlessOwner } from "../task-authorization.js";
import { bumpTaskMetric } from "../task-metrics.js";
import {
  createProjectSchema,
  createReminderSchema,
  createTaskSchema,
  updateReminderSchema,
  updateTaskSchema,
} from "../schemas.js";

function serializeProject(project: {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function serializeTask(task: {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  title: string;
  dueAt: Date | null;
  status: "OPEN" | "DONE" | "DISMISSED";
  source: "MANUAL" | "RADAR";
  clientDraftId: string | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    ownerUserId: task.ownerUserId,
    projectId: task.projectId,
    title: task.title,
    dueAt: task.dueAt?.toISOString() ?? null,
    status: task.status,
    source: task.source,
    clientDraftId: task.clientDraftId,
    conversationId: task.conversationId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function serializeReminder(reminder: {
  id: string;
  ownerUserId: string;
  taskId: string | null;
  remindAt: Date;
  status: "SCHEDULED" | "CANCELLED" | "FIRED";
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: reminder.id,
    ownerUserId: reminder.ownerUserId,
    taskId: reminder.taskId,
    remindAt: reminder.remindAt.toISOString(),
    status: reminder.status,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

export async function taskRoutes(app: FastifyInstance) {
  app.get("/projects", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const projects = await prisma.project.findMany({
      where: { ownerUserId: session.sub },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    reply.header("Cache-Control", "no-store");
    return { projects: projects.map(serializeProject) };
  });

  app.post("/projects", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid project" });
    }

    const project = await prisma.project.create({
      data: {
        ownerUserId: session.sub,
        name: parsed.data.name,
      },
    });
    return reply.code(201).send({ project: serializeProject(project) });
  });

  app.get("/tasks", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const tasks = await prisma.task.findMany({
      where: { ownerUserId: session.sub },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200,
    });
    bumpTaskMetric("tasks_listed_count");
    reply.header("Cache-Control", "no-store");
    return { tasks: tasks.map(serializeTask) };
  });

  app.post("/tasks", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid task" });
    }

    if (parsed.data.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: parsed.data.projectId },
        select: { ownerUserId: true },
      });
      const ownership = denyUnlessOwner({
        ownerUserId: project?.ownerUserId,
        sessionUserId: session.sub,
      });
      if (!ownership.ok) {
        bumpTaskMetric("tasks_authz_denied_count");
        return reply.code(ownership.status).send({ error: ownership.error });
      }
    }

    if (parsed.data.clientDraftId) {
      const existing = await prisma.task.findUnique({
        where: {
          ownerUserId_clientDraftId: {
            ownerUserId: session.sub,
            clientDraftId: parsed.data.clientDraftId,
          },
        },
      });
      if (existing) {
        return { task: serializeTask(existing), deduped: true };
      }
    }

    const task = await prisma.task.create({
      data: {
        ownerUserId: session.sub,
        title: parsed.data.title,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        projectId: parsed.data.projectId,
        source: parsed.data.source,
        clientDraftId: parsed.data.clientDraftId,
        conversationId: parsed.data.conversationId,
        status: parsed.data.status,
      },
    });
    bumpTaskMetric("tasks_created_count");
    return reply.code(201).send({ task: serializeTask(task), deduped: false });
  });

  app.patch("/tasks/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid task update" });
    }

    const existing = await prisma.task.findUnique({
      where: { id },
      select: { ownerUserId: true },
    });
    const ownership = denyUnlessOwner({
      ownerUserId: existing?.ownerUserId,
      sessionUserId: session.sub,
    });
    if (!ownership.ok) {
      bumpTaskMetric("tasks_authz_denied_count");
      return reply.code(ownership.status).send({ error: ownership.error });
    }

    if (parsed.data.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: parsed.data.projectId },
        select: { ownerUserId: true },
      });
      const projectOwnership = denyUnlessOwner({
        ownerUserId: project?.ownerUserId,
        sessionUserId: session.sub,
      });
      if (!projectOwnership.ok) {
        bumpTaskMetric("tasks_authz_denied_count");
        return reply.code(projectOwnership.status).send({
          error: projectOwnership.error,
        });
      }
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        title: parsed.data.title,
        dueAt:
          parsed.data.dueAt === undefined
            ? undefined
            : parsed.data.dueAt === null
              ? null
              : new Date(parsed.data.dueAt),
        projectId:
          parsed.data.projectId === undefined
            ? undefined
            : parsed.data.projectId,
        status: parsed.data.status,
      },
    });
    bumpTaskMetric("tasks_updated_count");
    return { task: serializeTask(task) };
  });

  app.get("/reminders", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const reminders = await prisma.reminder.findMany({
      where: { ownerUserId: session.sub },
      orderBy: { remindAt: "asc" },
      take: 200,
    });
    reply.header("Cache-Control", "no-store");
    return { reminders: reminders.map(serializeReminder) };
  });

  app.post("/reminders", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = createReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid reminder" });
    }

    if (parsed.data.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: parsed.data.taskId },
        select: { ownerUserId: true },
      });
      const ownership = denyUnlessOwner({
        ownerUserId: task?.ownerUserId,
        sessionUserId: session.sub,
      });
      if (!ownership.ok) {
        return reply.code(ownership.status).send({ error: ownership.error });
      }
    }

    const reminder = await prisma.reminder.create({
      data: {
        ownerUserId: session.sub,
        taskId: parsed.data.taskId,
        remindAt: new Date(parsed.data.remindAt),
      },
    });
    return reply.code(201).send({ reminder: serializeReminder(reminder) });
  });

  app.patch("/reminders/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const parsed = updateReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid reminder update" });
    }

    const existing = await prisma.reminder.findUnique({
      where: { id },
      select: { ownerUserId: true },
    });
    const ownership = denyUnlessOwner({
      ownerUserId: existing?.ownerUserId,
      sessionUserId: session.sub,
    });
    if (!ownership.ok) {
      return reply.code(ownership.status).send({ error: ownership.error });
    }

    const reminder = await prisma.reminder.update({
      where: { id },
      data: {
        remindAt: parsed.data.remindAt
          ? new Date(parsed.data.remindAt)
          : undefined,
        status: parsed.data.status,
      },
    });
    return { reminder: serializeReminder(reminder) };
  });
}
