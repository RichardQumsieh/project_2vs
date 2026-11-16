"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductShell } from "@/components/product-shell";
import { api, ApiError } from "@/lib/api";

type ProviderId = "google" | "outlook";

type Connection = {
  id: string;
  provider: "GOOGLE_CALENDAR" | "OUTLOOK_CALENDAR" | "GMAIL" | "OUTLOOK_MAIL";
  accountEmail: string | null;
  scopes: string[];
  status: "CONNECTED" | "REVOKED" | "ERROR";
  lastSyncAt: string | null;
  lastErrorCode: string | null;
};

type StatusResponse = {
  providers: {
    google: { configured: boolean; scopes: string[] };
    outlook: { configured: boolean; scopes: string[] };
  };
  privacy: {
    storesChatPlaintext: boolean;
    aiUsesCalendarBodiesByDefault: boolean;
    note: string;
  };
};

type CalendarEvent = {
  id: string;
  provider: string;
  accountEmail: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  busy: boolean;
};

function IntegrationsSettingsInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextStatus, nextConnections, nextEvents] = await Promise.all([
      api.calendarIntegrationStatus(),
      api.listCalendarConnections(),
      api.listCalendarEvents(),
    ]);
    setStatus(nextStatus);
    setConnections(nextConnections.connections);
    setEvents(nextEvents.events);
  }, []);

  useEffect(() => {
    const calendar = searchParams.get("calendar");
    const provider = searchParams.get("provider");
    const reason = searchParams.get("reason");
    if (calendar === "connected") {
      setNotice(
        `Connected ${provider === "outlook" ? "Outlook" : "Google"} Calendar. Sync when you are ready.`,
      );
    } else if (calendar === "error") {
      setError(
        reason
          ? `Calendar connect failed (${reason}).`
          : "Calendar connect failed.",
      );
    }
  }, [searchParams]);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(
        loadError instanceof ApiError
          ? loadError.message
          : "Could not load calendar integrations.",
      );
    });
  }, [refresh]);

  async function connect(provider: ProviderId) {
    setBusyProvider(provider);
    setError(null);
    try {
      const result = await api.beginCalendarOAuth(provider);
      window.location.assign(result.url);
    } catch (connectError) {
      setError(
        connectError instanceof ApiError
          ? connectError.message
          : "Could not start calendar OAuth.",
      );
      setBusyProvider(null);
    }
  }

  async function sync(provider: ProviderId) {
    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      const result = await api.syncCalendar(provider);
      setNotice(`Synced ${result.synced} events from ${provider}.`);
      await refresh();
    } catch (syncError) {
      setError(
        syncError instanceof ApiError
          ? syncError.message
          : "Calendar sync failed.",
      );
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnect(provider: ProviderId) {
    setBusyProvider(provider);
    setError(null);
    try {
      await api.disconnectCalendar(provider);
      setNotice(`Disconnected ${provider} calendar and cleared mirrored events.`);
      await refresh();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof ApiError
          ? disconnectError.message
          : "Could not disconnect calendar.",
      );
    } finally {
      setBusyProvider(null);
    }
  }

  function connectionFor(provider: ProviderId) {
    const prismaProvider =
      provider === "google" ? "GOOGLE_CALENDAR" : "OUTLOOK_CALENDAR";
    return connections.find((item) => item.provider === prismaProvider);
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm text-white/65 sm:p-6">
        <p className="font-medium text-white/85">Privacy bar</p>
        <p>
          {status?.privacy.note ??
            "Calendar mirrors are owner-scoped. Jarvis will not read event bodies for AI without a separate explicit consent later."}
        </p>
        <p className="text-xs text-white/45">
          Stores chat plaintext:{" "}
          {status?.privacy.storesChatPlaintext ? "yes" : "no"} · AI uses calendar
          bodies by default:{" "}
          {status?.privacy.aiUsesCalendarBodiesByDefault ? "yes" : "no"}
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

      {(["google", "outlook"] as const).map((provider) => {
        const configured = status?.providers[provider]?.configured ?? false;
        const connection = connectionFor(provider);
        const label =
          provider === "google" ? "Google Calendar" : "Outlook Calendar";
        return (
          <section
            key={provider}
            className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">{label}</h2>
                <p className="mt-1 text-xs text-white/45">
                  Scopes:{" "}
                  {(status?.providers[provider]?.scopes ?? []).join(", ") || "—"}
                </p>
                <p className="mt-2 text-sm text-white/60">
                  {configured
                    ? connection?.status === "CONNECTED"
                      ? `Connected${connection.accountEmail ? ` as ${connection.accountEmail}` : ""}.`
                      : "OAuth client configured. Connect to authorize read-only calendar access."
                    : "OAuth client env vars are not configured on the API yet."}
                </p>
                {connection?.lastSyncAt ? (
                  <p className="mt-1 text-xs text-white/40">
                    Last sync {new Date(connection.lastSyncAt).toLocaleString()}
                    {connection.lastErrorCode
                      ? ` · last error ${connection.lastErrorCode}`
                      : ""}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!configured || busyProvider === provider}
                  onClick={() => void connect(provider)}
                >
                  {connection?.status === "CONNECTED"
                    ? "Re-authorize"
                    : "Connect"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !configured ||
                    connection?.status !== "CONNECTED" ||
                    busyProvider === provider
                  }
                  onClick={() => void sync(provider)}
                >
                  Sync now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={
                    !connection ||
                    connection.status === "REVOKED" ||
                    busyProvider === provider
                  }
                  onClick={() => void disconnect(provider)}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </section>
        );
      })}

      <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-base font-semibold text-white">Mirrored events</h2>
        <p className="text-xs text-white/45">
          Owner-only window (−7 / +30 days). Titles and times only — not email or chat
          plaintext.
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-white/50">No mirrored events yet.</p>
        ) : (
          <ul className="space-y-2 text-sm text-white/70">
            {events.slice(0, 40).map((event) => (
              <li
                key={event.id}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              >
                <p className="font-medium text-white/85">{event.title}</p>
                <p className="text-xs text-white/45">
                  {event.provider.replace("_", " ")}
                  {event.accountEmail ? ` · ${event.accountEmail}` : ""} ·{" "}
                  {event.allDay
                    ? new Date(event.startsAt).toLocaleDateString()
                    : `${new Date(event.startsAt).toLocaleString()} – ${new Date(event.endsAt).toLocaleString()}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function IntegrationsSettingsPage() {
  return (
    <ProductShell
      title="Integrations"
      subtitle="Connect calendars with minimum OAuth scopes. Revocable anytime. Chat E2EE stays untouched."
    >
      <Suspense
        fallback={
          <p className="text-sm text-white/50">Loading integrations…</p>
        }
      >
        <IntegrationsSettingsInner />
      </Suspense>
    </ProductShell>
  );
}
