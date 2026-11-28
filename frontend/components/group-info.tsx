"use client";

import { useState, type FormEvent } from "react";
import { ChatPresence } from "@/components/avatar/chat-presence";
import { PersonAvatar } from "@/components/avatar/person-avatar";
import { GroupMessageBody } from "@/components/group-message-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type Conversation, type PublicUser } from "@/lib/api";
import type { LocalMessage } from "@/lib/crypto/types";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n } from "@/lib/i18n/locale";
import { mediaMessages, memberColor, memberInitials, memberLabel } from "@/lib/group-presentation";

export function GroupInfo({
  conversation,
  messages,
  canAdminister,
  selfUserId,
  onClose,
  onRename,
  onAdd,
  onRemove,
  onSetRole,
  onLeave,
}: {
  conversation: Conversation;
  messages: readonly LocalMessage[];
  canAdminister: boolean;
  selfUserId: string | null;
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
  onAdd: (person: PublicUser) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onSetRole: (userId: string, role: "ADMIN" | "MEMBER") => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(conversation.title ?? "");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PublicUser[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const media = mediaMessages(messages);
  const members = conversation.members ?? [];
  const titleText = conversation.title?.trim() || t("group.fallbackTitle");

  async function lookup(event: FormEvent) {
    event.preventDefault();
    const needle = query.trim().replace(/^@/, "");
    if (needle.length < 2) return;
    setBusy(true);
    try {
      const page = await api.lookupPeople(needle);
      const exact = page.users.find((user) => user.username === needle || (user.displayName ?? "").trim().toLowerCase() === needle.toLowerCase());
      if (exact || page.users.length === 1) {
        const person = exact ?? page.users[0];
        if (person) {
          await onAdd(person);
          setQuery("");
          setMatches([]);
        }
        return;
      }
      setMatches(page.users);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[#070b12]">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <Button type="button" size="sm" variant="ghost" onClick={onClose} title={t("group.backToChat")} aria-label={t("group.backToChat")}>
          {t("group.backToChat")}
        </Button>
        <h2 className="truncate text-sm font-medium">{t("group.info")}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <div className="flex items-center gap-3">
          <span
            className="grid size-14 place-items-center rounded-full text-lg font-semibold text-white"
            style={{ background: memberColor(conversation.id) }}
            aria-hidden="true"
          >
            {memberInitials(titleText)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-medium"><BidiText>{titleText}</BidiText></p>
            <p className="text-xs text-white/50">{t("group.memberCount", { count: members.length })}</p>
          </div>
        </div>
        {canAdminister ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onRename(title.trim());
            }}
          >
            <Input aria-label={t("group.name")} title={t("group.name")} value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
            <Button type="submit" size="sm" variant="outline">{t("group.rename")}</Button>
          </form>
        ) : null}
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-white/45">{t("group.members")}</h3>
          {focusedId ? (
            <div className="mt-4 flex justify-center">
              <ChatPresence
                person={members.find((member) => member.userId === focusedId)}
                contactId={focusedId}
                size={140}
              />
            </div>
          ) : null}
          <ul className="mt-3 space-y-2">
            {members.map((member) => {
              const label = memberLabel(member);
              return (
                <li key={member.userId} className="flex items-center justify-between gap-2 text-sm">
                  <button type="button" className="flex min-w-0 items-center gap-2 text-start" onClick={() => setFocusedId((current) => current === member.userId ? null : member.userId)}>
                    <PersonAvatar person={member} title={memberInitials(label)} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate"><BidiText>{label}</BidiText></span>
                      <span className="block truncate text-xs text-white/40">
                        <LtrIsolate>@{member.username}</LtrIsolate>
                        {" · "}
                        {member.role === "ADMIN" ? t("group.admin") : t("group.member")}
                      </span>
                    </span>
                  </button>
                  {canAdminister && member.userId !== selfUserId ? (
                    <span className="flex shrink-0 gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => void onSetRole(member.userId, member.role === "ADMIN" ? "MEMBER" : "ADMIN")}>
                        {member.role === "ADMIN" ? t("group.demote") : t("group.promote")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void onRemove(member.userId)}>
                        {t("group.remove")}
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canAdminister ? (
            <form className="mt-4 space-y-2" onSubmit={(event) => void lookup(event)}>
              <Input aria-label={t("group.usernames")} title={t("group.usernames")} placeholder={t("group.usernames")} value={query} dir="ltr" onChange={(event) => { setQuery(event.target.value); setMatches([]); }} />
              {matches.map((person) => (
                <button key={person.id} type="button" className="block w-full rounded-xl px-2 py-1 text-start text-xs text-white/80 hover:bg-white/10" onClick={() => void onAdd(person).then(() => { setQuery(""); setMatches([]); })}>
                  <BidiText>{person.displayName?.trim() || person.username}</BidiText> <LtrIsolate>@{person.username}</LtrIsolate>
                </button>
              ))}
              <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("group.add")}</Button>
            </form>
          ) : null}
        </section>
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-white/45">{t("group.media")}</h3>
          {media.length === 0 ? (
            <p className="mt-3 text-sm text-white/45">{t("group.noMedia")}</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {media.map((message) => (
                <li key={message.id} className="overflow-hidden rounded-xl border border-white/10 p-2">
                  <GroupMessageBody conversationId={conversation.id} plaintext={message.plaintext} fromMe={Boolean(message.fromMe)} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <Button type="button" variant="outline" onClick={() => void onLeave()}>{t("group.leave")}</Button>
      </div>
    </div>
  );
}
