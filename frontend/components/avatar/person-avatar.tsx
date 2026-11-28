"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  parseAvatarConfig,
  personInitials,
  type AvatarConfig,
  type AvatarPerson,
} from "@/lib/avatar/config";
import { presentationMode } from "@/lib/avatar/greeting";
import type { AvatarAnimation } from "@/lib/avatar/pose";
import { thumbnailDataUrl } from "@/lib/avatar/thumbnail";

const LiveAvatar = dynamic(() => import("./live-avatar").then((mod) => mod.LiveAvatar), {
  ssr: false,
});

export function PersonAvatar({
  person,
  title,
  size = 36,
  focused = false,
  staticAvatars = false,
  animation = "idle",
  playing = false,
  onGlError,
}: {
  person?: AvatarPerson | null;
  title?: string;
  size?: number;
  focused?: boolean;
  staticAvatars?: boolean;
  animation?: AvatarAnimation;
  playing?: boolean;
  onGlError?: () => void;
}) {
  const config = parseAvatarConfig(person?.avatarConfig);
  const label = title || personInitials(person);
  const root = useRef<HTMLSpanElement>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [staticSeen, setStaticSeen] = useState(staticAvatars);
  if (staticSeen !== staticAvatars) {
    setStaticSeen(staticAvatars);
    if (!staticAvatars && glFailed) setGlFailed(false);
  }
  const [photoFailed, setPhotoFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [onscreen, setOnscreen] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOnscreen(entry?.isIntersecting ?? true));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const mode = presentationMode({
    focused: focused && visible && onscreen,
    staticAvatars,
    glFailed,
  });
  const still = (
    <AvatarStill
      config={config}
      photoUrl={photoFailed ? null : person?.avatarUrl}
      label={label}
      size={size}
      onPhotoError={() => setPhotoFailed(true)}
    />
  );
  return (
    <span ref={root} className="relative inline-flex shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      {mode === "live" && config ? (
        <LiveAvatar
          config={config}
          animation={animation}
          playing={playing}
          onFail={() => {
            setGlFailed(true);
            onGlError?.();
          }}
        />
      ) : still}
    </span>
  );
}

export function AvatarStill({
  config,
  photoUrl,
  label,
  size,
  onPhotoError,
}: {
  config: AvatarConfig | null;
  photoUrl?: string | null;
  label: string;
  size: number;
  onPhotoError?: () => void;
}) {
  const src = config ? thumbnailDataUrl(config) : null;
  return (
    <span
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-cyan-300/15 text-[0.7em] font-semibold text-cyan-50"
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
      aria-hidden="true"
    >
      {src ? (
        // The snapshot is a data URL rendered on this device from the avatar JSON.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" onError={onPhotoError} />
      ) : (
        label.slice(0, 2)
      )}
    </span>
  );
}
