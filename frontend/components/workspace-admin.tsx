"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, type WorkspaceInviteRow, type WorkspaceMemberRow, type WorkspaceRole, type WorkspaceSummary } from "@/lib/api";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const roleKey: Record<WorkspaceRole, MessageKey> = {
  OWNER: "workspace.roleOwner",
  ADMIN: "workspace.roleAdmin",
  MEMBER: "workspace.roleMember",
};

export function WorkspaceAdmin() {
  const { t } = useI18n();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteRow[]>([]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [freshCode, setFreshCode] = useState<{ code: string; path: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmUserId, setConfirmUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null;
  const canInvite = selected?.role === "OWNER" || selected?.role === "ADMIN";
  const isOwner = selected?.role === "OWNER";

  async function loadList(preferId?: string) {
    const page = await api.listWorkspaces();
    setWorkspaces(page.workspaces);
    const next = preferId && page.workspaces.some((workspace) => workspace.id === preferId)
      ? preferId
      : page.workspaces[0]?.id ?? null;
    setSelectedId(next);
    return next;
  }

  async function loadDetail(id: string) {
    const detail = await api.workspaceDetail(id);
    setWorkspaces((current) => current.map((workspace) => workspace.id === id ? detail.workspace : workspace));
    setMembers(detail.members);
    setInvites(detail.invites);
  }

  useEffect(() => {
    let cancel = false;
    setBusy(true);
    api.listWorkspaces().then((page) => {
      if (cancel) return;
      setWorkspaces(page.workspaces);
      setSelectedId(page.workspaces[0]?.id ?? null);
    }).catch((caught) => {
      if (cancel) return;
      if (caught instanceof ApiError && caught.status === 401) {
        setSignedOut(true);
        return;
      }
      setError(caught instanceof ApiError ? caught.message : t("workspace.loadFailed"));
    }).finally(() => {
      if (!cancel) setBusy(false);
    });
    return () => {
      cancel = true;
    };
  }, [t]);

  useEffect(() => {
    if (!selectedId) return;
    let cancel = false;
    api.workspaceDetail(selectedId).then((detail) => {
      if (cancel) return;
      setWorkspaces((current) => current.map((workspace) => (
        workspace.id === selectedId ? detail.workspace : workspace
      )));
      setMembers(detail.members);
      setInvites(detail.invites);
    }).catch((caught) => {
      if (cancel) return;
      if (caught instanceof ApiError && caught.status === 401) setSignedOut(true);
    });
    return () => {
      cancel = true;
    };
  }, [selectedId]);

  const visibleMembers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) => {
      const display = member.displayName?.toLowerCase() ?? "";
      return member.username.includes(needle) || display.includes(needle);
    });
  }, [members, query]);

  async function create(kind: "FAMILY" | "TEAM", event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await api.createWorkspace({ name, kind });
      setName("");
      setNotice(t("workspace.created"));
      await loadList(created.workspace.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("workspace.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    if (!selected) return;
    setError(null);
    setFreshCode(null);
    setBusy(true);
    try {
      const created = await api.createWorkspaceInvite(selected.id);
      setFreshCode({ code: created.invite.code, path: created.invite.path });
      await loadDetail(selected.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("workspace.seatLimit"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!freshCode) return;
    const link = `${window.location.origin}${freshCode.path}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function message(username: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await api.workspaceDirect(selected.id, username);
      router.push(`/inbox/${conversation.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("workspace.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function startGroup(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await api.workspaceGroup(selected.id, {
        title: groupTitle.trim() || undefined,
        memberUserIds: groupIds,
      });
      router.push(`/inbox/${conversation.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("workspace.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (signedOut) {
    return <p className="text-sm text-(--muted)"><Link href="/login" className="underline-offset-4 hover:underline">{t("workspace.signIn")}</Link></p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-(--muted)">{t("workspace.encryptionNote")}</p>
      <form className="flex flex-col gap-3 rounded-3xl border border-(--line) bg-(--glass) p-4 sm:p-5" onSubmit={(event) => void create("FAMILY", event)}>
        <label className="flex flex-col gap-1 text-sm text-(--foreground)">
          {t("workspace.name")}
          <input
            value={name}
            required
            minLength={2}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11 rounded-2xl border border-(--line) bg-(--control-bg) px-3 text-base"
          />
        </label>
        <p className="text-xs text-(--muted)">{t("workspace.nameRule")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50">
            {t("workspace.createFamily")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(event) => void create("TEAM", event)}
            className="min-h-11 rounded-full border border-(--line) px-4 text-sm text-(--foreground) disabled:opacity-50"
          >
            {t("workspace.createTeam")}
          </button>
        </div>
      </form>

      {workspaces.length === 0 && !busy ? <p className="text-sm text-(--muted)">{t("workspace.empty")}</p> : null}

      {workspaces.length > 0 ? (
        <div className="flex flex-col gap-2" aria-label={t("workspace.switchFamily")}>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              aria-pressed={workspace.id === selectedId}
              onClick={() => {
                setSelectedId(workspace.id);
                setFreshCode(null);
                setQuery("");
              }}
              className={`min-h-11 rounded-2xl border px-4 text-start text-sm ${
                workspace.id === selectedId
                  ? "border-(--foreground) bg-(--control-hover) text-(--foreground)"
                  : "border-(--line) text-(--muted)"
              }`}
            >
              <BidiText>{workspace.name}</BidiText>
              <span className="ms-2 text-xs">{t(roleKey[workspace.role])}</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <section className="flex flex-col gap-4 rounded-3xl border border-(--line) bg-(--glass) p-4 sm:p-5" aria-label={selected.name}>
          <div>
            <h2 className="text-lg font-medium text-(--foreground)"><BidiText>{selected.name}</BidiText></h2>
            <p className="mt-1 text-sm text-(--muted)">
              {t("workspace.seats", { count: selected.seatCount, limit: selected.seatLimit })}
            </p>
            <p className="mt-1 text-sm text-(--muted)">
              {selected.dailyBrief ? t("workspace.briefOn") : t("workspace.briefOff")}
            </p>
            <p className="mt-1 text-sm text-(--muted)">
              {selected.billingEnabled ? t("workspace.billingOn") : t("workspace.billingOff")}
            </p>
            {isOwner ? (
              <Link href="/billing/upgrade" className="mt-3 inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">
                {t("billing.upgradeLink")}
              </Link>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-(--foreground)">{t("workspace.members")}</h3>
            <label className="sr-only" htmlFor="workspace-member-search">{t("workspace.members")}</label>
            <input
              id="workspace-member-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("workspace.members")}
              className="min-h-11 rounded-2xl border border-(--line) bg-(--control-bg) px-3 text-base"
            />
            <ul className="flex flex-col gap-3">
              {visibleMembers.map((member) => (
                <li key={member.userId} className="flex flex-col gap-2 border-t border-(--line) pt-3">
                  <p className="text-sm text-(--foreground)">
                    <BidiText>{member.displayName || member.username}</BidiText>
                    {" "}
                    <LtrIsolate>@{member.username}</LtrIsolate>
                    <span className="ms-2 text-xs text-(--muted)">{t(roleKey[member.role])}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="min-h-11 rounded-full border border-(--line) px-3 text-xs" onClick={() => void message(member.username)}>
                      {t("workspace.message")}
                    </button>
                    {isOwner && member.role !== "OWNER" ? (
                      <>
                        <button type="button" className="min-h-11 rounded-full border border-(--line) px-3 text-xs" onClick={() => void api.setWorkspaceRole(selected.id, member.userId, "ADMIN").then(() => loadDetail(selected.id))}>
                          {t("workspace.makeAdmin")}
                        </button>
                        <button type="button" className="min-h-11 rounded-full border border-(--line) px-3 text-xs" onClick={() => void api.setWorkspaceRole(selected.id, member.userId, "MEMBER").then(() => loadDetail(selected.id))}>
                          {t("workspace.makeMember")}
                        </button>
                        <button type="button" className="min-h-11 rounded-full border border-(--line) px-3 text-xs" onClick={() => void api.setWorkspaceRole(selected.id, member.userId, "OWNER").then(() => loadDetail(selected.id))}>
                          {t("workspace.transferOwner")}
                        </button>
                      </>
                    ) : null}
                    {(isOwner || (canInvite && member.role === "MEMBER")) && member.role !== "OWNER" ? (
                      <button
                        type="button"
                        className="min-h-11 rounded-full border border-(--line) px-3 text-xs"
                        onClick={() => {
                          if (confirmUserId !== member.userId) {
                            setConfirmUserId(member.userId);
                            return;
                          }
                          void api.removeWorkspaceMember(selected.id, member.userId).then(() => {
                            setConfirmUserId(null);
                            return loadDetail(selected.id);
                          });
                        }}
                      >
                        {confirmUserId === member.userId ? t("workspace.confirmRemove") : t("workspace.remove")}
                      </button>
                    ) : null}
                    {member.role !== "OWNER" ? (
                      <label className="inline-flex min-h-11 items-center gap-2 text-xs text-(--muted)">
                        <input
                          type="checkbox"
                          checked={groupIds.includes(member.userId)}
                          onChange={(event) => {
                            setGroupIds((current) => event.target.checked
                              ? [...current, member.userId]
                              : current.filter((id) => id !== member.userId));
                          }}
                        />
                        {t("workspace.group")}
                      </label>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <form className="flex flex-col gap-2" onSubmit={(event) => void startGroup(event)}>
            <label className="flex flex-col gap-1 text-sm text-(--foreground)">
              {t("workspace.groupTitle")}
              <input
                value={groupTitle}
                maxLength={80}
                onChange={(event) => setGroupTitle(event.target.value)}
                className="min-h-11 rounded-2xl border border-(--line) bg-(--control-bg) px-3 text-base"
              />
            </label>
            <button type="submit" disabled={busy || groupIds.length === 0} className="min-h-11 rounded-full border border-(--line) px-4 text-sm disabled:opacity-50">
              {t("workspace.group")}
            </button>
          </form>

          {canInvite ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-(--foreground)">{t("workspace.invites")}</h3>
              <p className="text-sm leading-6 text-(--muted)">{t("workspace.inviteHelp")}</p>
              <button type="button" disabled={busy} onClick={() => void createInvite()} className="min-h-11 rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50">
                {t("workspace.createInvite")}
              </button>
              {freshCode ? (
                <div className="rounded-2xl border border-(--line) p-3">
                  <p className="text-sm text-(--foreground)">{t("workspace.inviteOnce")}</p>
                  <p className="mt-2 text-sm" dir="ltr"><LtrIsolate>{freshCode.code}</LtrIsolate></p>
                  <p className="mt-1 text-xs" dir="ltr"><LtrIsolate>{freshCode.path}</LtrIsolate></p>
                  <button type="button" onClick={() => void copyLink()} className="mt-3 min-h-11 rounded-full border border-(--line) px-3 text-xs">
                    {copied ? t("workspace.copied") : t("workspace.copy")}
                  </button>
                </div>
              ) : null}
              <ul className="flex flex-col gap-2">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <LtrIsolate>····{invite.hint}</LtrIsolate>
                      <span className="ms-2 text-xs text-(--muted)">
                        {invite.revokedAt
                          ? t("workspace.revoked")
                          : invite.consumedAt
                            ? t("workspace.used")
                            : t("workspace.expires", { when: invite.expiresAt.slice(0, 10) })}
                      </span>
                    </span>
                    {!invite.revokedAt && !invite.consumedAt ? (
                      <button
                        type="button"
                        className="min-h-11 rounded-full border border-(--line) px-3 text-xs"
                        onClick={() => void api.revokeWorkspaceInvite(selected.id, invite.id).then(() => loadDetail(selected.id))}
                      >
                        {t("workspace.revoke")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {notice ? <p role="status" className="text-sm text-(--foreground)">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
