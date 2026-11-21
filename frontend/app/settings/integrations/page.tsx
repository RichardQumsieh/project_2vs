"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductShell } from "@/components/product-shell";
import { api, ApiError } from "@/lib/api";
import { LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n } from "@/lib/i18n/locale";

type CalendarProviderId = "google" | "outlook";
type EmailProviderId = "gmail" | "outlook-mail";
type WorkProviderId = "github" | "linear";
type CollabProviderId = "slack";

type Connection = {
  id: string;
  provider:
    | "GOOGLE_CALENDAR"
    | "OUTLOOK_CALENDAR"
    | "GMAIL"
    | "OUTLOOK_MAIL"
    | "GITHUB"
    | "LINEAR"
    | "SLACK";
  accountEmail: string | null;
  scopes: string[];
  status: "CONNECTED" | "REVOKED" | "ERROR";
  lastSyncAt: string | null;
  lastErrorCode: string | null;
};

type ProviderStatus = {
  configured: boolean;
  scopes: string[];
  requiredWriteScopes?: string[];
};

function normalizeScopeToken(scope: string) {
  const trimmed = scope.trim();
  if (!trimmed) return "";
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    return parts[parts.length - 1]!.toLowerCase();
  }
  return trimmed.toLowerCase();
}

function connectionNeedsWriteUpgrade(
  connection: Connection | undefined,
  requiredWriteScopes: string[] | undefined,
) {
  if (!connection || connection.status !== "CONNECTED") {
    return false;
  }
  if (!requiredWriteScopes || requiredWriteScopes.length === 0) {
    return false;
  }
  const granted = new Set(connection.scopes.map(normalizeScopeToken));
  return requiredWriteScopes.some(
    (scope) => !granted.has(normalizeScopeToken(scope)),
  );
}

function IntegrationsSettingsInner() {
  const searchParams = useSearchParams();
  const [calendarStatus, setCalendarStatus] = useState<{
    providers: {
      google: ProviderStatus;
      outlook: ProviderStatus;
    };
    writesEnabled?: boolean;
    privacy: { note: string; storesChatPlaintext: boolean };
  } | null>(null);
  const [emailStatus, setEmailStatus] = useState<{
    providers: {
      gmail: ProviderStatus;
      "outlook-mail": ProviderStatus;
    };
    writesEnabled?: boolean;
    privacy: { note: string; storesFullBodies: boolean };
  } | null>(null);
  const [workStatus, setWorkStatus] = useState<{
    providers: {
      github: ProviderStatus;
      linear: ProviderStatus;
    };
    writesEnabled?: boolean;
    privacy: { note: string; storesIssueBodies: boolean };
  } | null>(null);
  const [collabStatus, setCollabStatus] = useState<{
    providers: {
      slack: ProviderStatus;
    };
    writesEnabled?: boolean;
    privacy: { note: string; storesMessageHistory: boolean };
  } | null>(null);
  const [calendarConnections, setCalendarConnections] = useState<Connection[]>(
    [],
  );
  const [emailConnections, setEmailConnections] = useState<Connection[]>([]);
  const [workConnections, setWorkConnections] = useState<Connection[]>([]);
  const [collabConnections, setCollabConnections] = useState<Connection[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [
      nextCalendarStatus,
      nextEmailStatus,
      nextWorkStatus,
      nextCollabStatus,
      nextCalendarConnections,
      nextEmailConnections,
      nextWorkConnections,
      nextCollabConnections,
    ] = await Promise.all([
      api.calendarIntegrationStatus(),
      api.emailIntegrationStatus(),
      api.workIntegrationStatus(),
      api.collabIntegrationStatus(),
      api.listCalendarConnections(),
      api.listEmailConnections(),
      api.listWorkConnections(),
      api.listCollabConnections(),
    ]);
    setCalendarStatus(nextCalendarStatus);
    setEmailStatus(nextEmailStatus);
    setWorkStatus(nextWorkStatus);
    setCollabStatus(nextCollabStatus);
    setCalendarConnections(nextCalendarConnections.connections);
    setEmailConnections(nextEmailConnections.connections);
    setWorkConnections(nextWorkConnections.connections);
    setCollabConnections(nextCollabConnections.connections);
  }, []);

  useEffect(() => {
    const calendar = searchParams.get("calendar");
    const email = searchParams.get("email");
    const work = searchParams.get("work");
    const collab = searchParams.get("collab");
    const provider = searchParams.get("provider");
    const reason = searchParams.get("reason");
    if (calendar === "connected") {
      setNotice(
        `Connected ${provider === "outlook" ? "Outlook" : "Google"} Calendar.`,
      );
    } else if (calendar === "error") {
      setError(reason ? `Calendar connect failed (${reason}).` : "Calendar connect failed.");
    } else if (email === "connected") {
      setNotice(
        `Connected ${provider === "outlook-mail" ? "Outlook Mail" : "Gmail"}.`,
      );
    } else if (email === "error") {
      setError(reason ? `Email connect failed (${reason}).` : "Email connect failed.");
    } else if (work === "connected") {
      setNotice(`Connected ${provider === "linear" ? "Linear" : "GitHub"}.`);
    } else if (work === "error") {
      setError(reason ? `Work connect failed (${reason}).` : "Work connect failed.");
    } else if (collab === "connected") {
      setNotice("Connected Slack.");
    } else if (collab === "error") {
      setError(reason ? `Collab connect failed (${reason}).` : "Collab connect failed.");
    }
  }, [searchParams]);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(
        loadError instanceof ApiError
          ? loadError.message
          : "Could not load integrations.",
      );
    });
  }, [refresh]);

  function calendarConnection(provider: CalendarProviderId) {
    const key = provider === "google" ? "GOOGLE_CALENDAR" : "OUTLOOK_CALENDAR";
    return calendarConnections.find((item) => item.provider === key);
  }

  function emailConnection(provider: EmailProviderId) {
    const key = provider === "gmail" ? "GMAIL" : "OUTLOOK_MAIL";
    return emailConnections.find((item) => item.provider === key);
  }

  function workConnection(provider: WorkProviderId) {
    const key = provider === "github" ? "GITHUB" : "LINEAR";
    return workConnections.find((item) => item.provider === key);
  }

  function collabConnection(provider: CollabProviderId) {
    return collabConnections.find((item) => item.provider === "SLACK");
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm text-white/65 sm:p-6">
        <p className="font-medium text-white/85">Privacy bar</p>
        <p>
          {calendarStatus?.privacy.note ??
            "Calendar mirrors store title and time. Opening an event fetches the rest with your token and does not store it. Chat E2EE is untouched."}
        </p>
        <p className="text-xs text-white/45">
          {emailStatus?.privacy.note ??
            "Mail mirrors store subject, sender, and a short snippet. Opening a message fetches the body with your token and does not store it."}
        </p>
        <p className="text-xs text-white/45">
          {workStatus?.privacy.note ??
            "Work sync stores title/state/url only — not issue bodies or chat plaintext."}
        </p>
        <p className="text-xs text-white/45">
          {collabStatus?.privacy.note ??
            "Slack sync stores channel names/ids only — not message history or chat plaintext."}
        </p>
        <p className="text-sm text-white/75">
          Recent mail and upcoming events are in the{" "}
          <Link href="/inbox" className="underline underline-offset-2">
            inbox
          </Link>
          . Compose and scheduling stay there and still require approval. This page only connects, reconnects, or upgrades scopes.
        </p>
        <p className="text-xs text-amber-100/70">
          {calendarStatus?.writesEnabled ||
          emailStatus?.writesEnabled ||
          workStatus?.writesEnabled ||
          collabStatus?.writesEnabled
            ? "Provider write APIs are enabled on this server. Outbound actions still require an already-approved structured payload (Sophia propose→approve is separate)."
            : "Provider write APIs are off until operators set INTEGRATIONS_WRITE_ENABLED after updating Google/Azure/GitHub/Linear/Slack consoles. Re-authorize connected accounts to pick up write scopes."}
        </p>
      </section>

      {notice ? (
        <p className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </p>
      ) : null}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
        Calendars
      </h2>
      {(["google", "outlook"] as const).map((provider) => {
        const configured =
          calendarStatus?.providers[provider]?.configured ?? false;
        const connection = calendarConnection(provider);
        const label =
          provider === "google" ? "Google Calendar" : "Outlook Calendar";
        const key = `cal:${provider}`;
        return (
          <ProviderCard
            key={key}
            label={label}
            scopes={calendarStatus?.providers[provider]?.scopes ?? []}
            configured={configured}
            connection={connection}
            needsScopeUpgrade={connectionNeedsWriteUpgrade(
              connection,
              calendarStatus?.providers[provider]?.requiredWriteScopes,
            )}
            busy={busyKey === key}
            onConnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .beginCalendarOAuth(provider)
                .then((result) => window.location.assign(result.url))
                .catch((connectError: unknown) => {
                  setError(
                    connectError instanceof ApiError
                      ? connectError.message
                      : "Could not start calendar OAuth.",
                  );
                  setBusyKey(null);
                });
            }}
            onSync={() => {
              setBusyKey(key);
              setError(null);
              void api
                .syncCalendar(provider)
                .then(async (result) => {
                  setNotice(`Synced ${result.synced} calendar events.`);
                  await refresh();
                })
                .catch((syncError: unknown) => {
                  setError(
                    syncError instanceof ApiError
                      ? syncError.message
                      : "Calendar sync failed.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
            onDisconnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .disconnectCalendar(provider)
                .then(async () => {
                  setNotice(`Disconnected ${label}.`);
                  await refresh();
                })
                .catch((disconnectError: unknown) => {
                  setError(
                    disconnectError instanceof ApiError
                      ? disconnectError.message
                      : "Could not disconnect calendar.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
          />
        );
      })}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
        Email
      </h2>
      {(["gmail", "outlook-mail"] as const).map((provider) => {
        const configured =
          emailStatus?.providers[provider]?.configured ?? false;
        const connection = emailConnection(provider);
        const label = provider === "gmail" ? "Gmail" : "Outlook Mail";
        const key = `mail:${provider}`;
        return (
          <ProviderCard
            key={key}
            label={label}
            scopes={emailStatus?.providers[provider]?.scopes ?? []}
            configured={configured}
            connection={connection}
            needsScopeUpgrade={connectionNeedsWriteUpgrade(
              connection,
              emailStatus?.providers[provider]?.requiredWriteScopes,
            )}
            busy={busyKey === key}
            onConnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .beginEmailOAuth(provider)
                .then((result) => window.location.assign(result.url))
                .catch((connectError: unknown) => {
                  setError(
                    connectError instanceof ApiError
                      ? connectError.message
                      : "Could not start email OAuth.",
                  );
                  setBusyKey(null);
                });
            }}
            onSync={() => {
              setBusyKey(key);
              setError(null);
              void api
                .syncEmail(provider)
                .then(async (result) => {
                  setNotice(`Synced ${result.synced} mail metadata rows.`);
                  await refresh();
                })
                .catch((syncError: unknown) => {
                  setError(
                    syncError instanceof ApiError
                      ? syncError.message
                      : "Email sync failed.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
            onDisconnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .disconnectEmail(provider)
                .then(async () => {
                  setNotice(`Disconnected ${label}.`);
                  await refresh();
                })
                .catch((disconnectError: unknown) => {
                  setError(
                    disconnectError instanceof ApiError
                      ? disconnectError.message
                      : "Could not disconnect email.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
          />
        );
      })}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
        Work trackers
      </h2>
      {(["github", "linear"] as const).map((provider) => {
        const configured =
          workStatus?.providers[provider]?.configured ?? false;
        const connection = workConnection(provider);
        const label = provider === "github" ? "GitHub" : "Linear";
        const key = `work:${provider}`;
        return (
          <ProviderCard
            key={key}
            label={label}
            scopes={workStatus?.providers[provider]?.scopes ?? []}
            configured={configured}
            connection={connection}
            needsScopeUpgrade={connectionNeedsWriteUpgrade(
              connection,
              workStatus?.providers[provider]?.requiredWriteScopes,
            )}
            busy={busyKey === key}
            onConnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .beginWorkOAuth(provider)
                .then((result) => window.location.assign(result.url))
                .catch((connectError: unknown) => {
                  setError(
                    connectError instanceof ApiError
                      ? connectError.message
                      : "Could not start work OAuth.",
                  );
                  setBusyKey(null);
                });
            }}
            onSync={() => {
              setBusyKey(key);
              setError(null);
              void api
                .syncWork(provider)
                .then(async (result) => {
                  setNotice(`Synced ${result.synced} work items.`);
                  await refresh();
                })
                .catch((syncError: unknown) => {
                  setError(
                    syncError instanceof ApiError
                      ? syncError.message
                      : "Work sync failed.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
            onDisconnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .disconnectWork(provider)
                .then(async () => {
                  setNotice(`Disconnected ${label}.`);
                  await refresh();
                })
                .catch((disconnectError: unknown) => {
                  setError(
                    disconnectError instanceof ApiError
                      ? disconnectError.message
                      : "Could not disconnect work provider.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
          />
        );
      })}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
        Collaboration
      </h2>
      {(["slack"] as const).map((provider) => {
        const configured =
          collabStatus?.providers[provider]?.configured ?? false;
        const connection = collabConnection(provider);
        const label = "Slack";
        const key = `collab:${provider}`;
        return (
          <ProviderCard
            key={key}
            label={label}
            scopes={collabStatus?.providers[provider]?.scopes ?? []}
            configured={configured}
            connection={connection}
            needsScopeUpgrade={connectionNeedsWriteUpgrade(
              connection,
              collabStatus?.providers[provider]?.requiredWriteScopes,
            )}
            busy={busyKey === key}
            onConnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .beginCollabOAuth(provider)
                .then((result) => window.location.assign(result.url))
                .catch((connectError: unknown) => {
                  setError(
                    connectError instanceof ApiError
                      ? connectError.message
                      : "Could not start Slack OAuth.",
                  );
                  setBusyKey(null);
                });
            }}
            onSync={() => {
              setBusyKey(key);
              setError(null);
              void api
                .syncCollab(provider)
                .then(async (result) => {
                  setNotice(`Synced ${result.synced} Slack channels.`);
                  await refresh();
                })
                .catch((syncError: unknown) => {
                  setError(
                    syncError instanceof ApiError
                      ? syncError.message
                      : "Slack sync failed.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
            onDisconnect={() => {
              setBusyKey(key);
              setError(null);
              void api
                .disconnectCollab(provider)
                .then(async () => {
                  setNotice(`Disconnected ${label}.`);
                  await refresh();
                })
                .catch((disconnectError: unknown) => {
                  setError(
                    disconnectError instanceof ApiError
                      ? disconnectError.message
                      : "Could not disconnect Slack.",
                  );
                })
                .finally(() => setBusyKey(null));
            }}
          />
        );
      })}

    </div>
  );
}

function ProviderCard(props: {
  label: string;
  scopes: string[];
  configured: boolean;
  connection?: Connection;
  needsScopeUpgrade?: boolean;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const { label, scopes, configured, connection, needsScopeUpgrade, busy } =
    props;
  const { t } = useI18n();
  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{label}</h3>
          <p className="mt-1 text-xs text-white/45">
            {t("integrations.scopes")}: {scopes.join(", ") || "—"}
          </p>
          <p className="mt-2 text-sm text-white/60">
            {configured
              ? connection?.status === "CONNECTED"
                ? (
                  <>
                    {t("integrations.connected")}
                    {connection.accountEmail ? <> <LtrIsolate>{connection.accountEmail}</LtrIsolate></> : null}
                  </>
                )
                : t("integrations.ready")
              : t("integrations.unconfigured")}
          </p>
          {needsScopeUpgrade ? (
            <p className="mt-2 text-sm text-amber-100/80">
              {t("integrations.upgradeBody")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            title={needsScopeUpgrade ? t("integrations.upgrade") : connection?.status === "CONNECTED" ? t("integrations.reauth") : t("integrations.connect")}
            aria-label={needsScopeUpgrade ? t("integrations.upgrade") : connection?.status === "CONNECTED" ? t("integrations.reauth") : t("integrations.connect")}
            disabled={!configured || busy}
            onClick={props.onConnect}
          >
            {needsScopeUpgrade
              ? t("integrations.upgrade")
              : connection?.status === "CONNECTED"
                ? t("integrations.reauth")
                : t("integrations.connect")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title={t("integrations.sync")}
            aria-label={t("integrations.sync")}
            disabled={!configured || connection?.status !== "CONNECTED" || busy}
            onClick={props.onSync}
          >
            {t("integrations.sync")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title={t("integrations.disconnect")}
            aria-label={t("integrations.disconnect")}
            disabled={!connection || connection.status === "REVOKED" || busy}
            onClick={props.onDisconnect}
          >
            {t("integrations.disconnect")}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function IntegrationsSettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell
      title={t("integrations.title")}
      subtitle={t("integrations.subtitle")}
    >
      <Suspense
        fallback={<p className="text-sm text-white/50">{t("integrations.loading")}</p>}
      >
        <IntegrationsSettingsInner />
      </Suspense>
    </ProductShell>
  );
}
