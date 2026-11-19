import { prisma } from "../db.js";
import {
  integrationsWriteAllowlist,
  integrationsWriteEnabled,
} from "../env.js";
import {
  gateIntegrationWrite,
  userMatchesWriteAllowlist,
  type WriteGateFailure,
  type WriteGateSuccess,
} from "./write-gate.js";

async function allowlistEmail(userId: string) {
  if (!integrationsWriteEnabled || integrationsWriteAllowlist.length === 0) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email ?? null;
}

export async function sessionWriteAudience(session: {
  sub: string;
  username: string;
}) {
  const userEmail = await allowlistEmail(session.sub);
  return {
    writesEnabled: integrationsWriteEnabled,
    allowlist: integrationsWriteAllowlist,
    username: session.username,
    userEmail,
  };
}

/** Whether this signed-in account may use write APIs. Flag off always wins. */
export async function sessionWritesEnabled(session: {
  sub: string;
  username: string;
}) {
  const audience = await sessionWriteAudience(session);
  if (!audience.writesEnabled) return false;
  return userMatchesWriteAllowlist({
    allowlist: audience.allowlist,
    userId: session.sub,
    username: audience.username,
    email: audience.userEmail,
  });
}

export async function gateWriteForSession(input: {
  session: { sub: string; username: string };
  ownerUserId: string | null | undefined;
  status: string | null | undefined;
  grantedScopes: string[];
  requiredWriteScopes: readonly string[];
}): Promise<WriteGateSuccess | WriteGateFailure> {
  const userEmail = await allowlistEmail(input.session.sub);
  return gateIntegrationWrite({
    ownerUserId: input.ownerUserId,
    sessionUserId: input.session.sub,
    status: input.status,
    grantedScopes: input.grantedScopes,
    requiredWriteScopes: input.requiredWriteScopes,
    writesEnabled: integrationsWriteEnabled,
    allowlist: integrationsWriteAllowlist,
    username: input.session.username,
    userEmail,
  });
}
