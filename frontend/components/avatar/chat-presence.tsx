"use client";

import { useEffect, useRef, useState } from "react";
import { PersonAvatar } from "@/components/avatar/person-avatar";
import {
  parseAvatarConfig,
  parseGreetingAnimation,
  parseGreetingText,
  type AvatarPerson,
} from "@/lib/avatar/config";
import { createGreetingSession, prefersStaticAvatars, type Entrance } from "@/lib/avatar/greeting";
import { readAvatarPrefs, readReducedMotion, speakGreeting } from "@/lib/avatar/prefs";
import { animationDuration, type AvatarAnimation } from "@/lib/avatar/pose";

const session = createGreetingSession();

export function ChatPresence({
  person,
  contactId,
  conversationId,
  isNew = false,
  size = 40,
  focused = true,
}: {
  person?: AvatarPerson | null;
  contactId: string;
  conversationId?: string | null;
  isNew?: boolean;
  size?: number;
  focused?: boolean;
}) {
  const [entrance, setEntrance] = useState<Entrance | null>(null);
  const [running, setRunning] = useState(false);
  const [showText, setShowText] = useState(false);
  const [prefs, setPrefs] = useState({ staticAvatars: false, speakGreetings: false });
  const [reducedMotion, setReducedMotion] = useState(false);
  const spoken = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPrefs(readAvatarPrefs());
      setReducedMotion(readReducedMotion());
    });
    return () => cancelAnimationFrame(frame);
  }, [contactId]);
  useEffect(() => {
    let cancel = false;
    const frame = requestAnimationFrame(() => {
      if (cancel) return;
      const next = session.enter({
        contactId,
        conversationId,
        isNew,
        hasAvatar: Boolean(parseAvatarConfig(person?.avatarConfig)),
        animation: parseGreetingAnimation(person?.greetingAnimation),
        text: parseGreetingText(person?.greetingText ?? null),
      });
      setEntrance(next);
      setShowText(Boolean(next?.text));
      setRunning(Boolean(next?.live));
    });
    return () => {
      cancel = true;
      cancelAnimationFrame(frame);
    };
  }, [contactId, conversationId, isNew, person?.avatarConfig, person?.greetingAnimation, person?.greetingText]);
  useEffect(() => {
    if (!entrance) return;
    const hideText = window.setTimeout(() => setShowText(false), 4200);
    const stop = window.setTimeout(() => setRunning(false), entrance.live ? animationDuration(entrance.animation) : 0);
    return () => {
      window.clearTimeout(hideText);
      window.clearTimeout(stop);
    };
  }, [entrance]);
  useEffect(() => {
    if (!entrance?.text || spoken.current) return;
    const current = readAvatarPrefs();
    if (!current.speakGreetings) return;
    spoken.current = true;
    speakGreeting(entrance.text);
  }, [entrance]);
  const staticAvatars = prefersStaticAvatars(prefs, reducedMotion);
  const animation: AvatarAnimation = running && entrance && !staticAvatars ? entrance.animation : "idle";
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 ${size >= 100 ? "flex-col" : ""}`}>
      <PersonAvatar
        person={person}
        size={size}
        focused={focused && running}
        staticAvatars={staticAvatars}
        animation={animation}
        playing={running && !staticAvatars}
      />
      {showText && entrance?.text ? (
        <span role="status" className="max-w-52 rounded-2xl bg-white px-3 py-1.5 text-xs text-black shadow-lg">
          {entrance.text}
        </span>
      ) : null}
    </span>
  );
}
