"use client";

import Image from "next/image";
import type { CompanionPresenceState } from "@/lib/ai/companion-runtime";

type JarvisRobotProps = {
  presence: CompanionPresenceState;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
};

const sizeClass = {
  sm: "h-16 w-16",
  md: "h-28 w-28 sm:h-32 sm:w-32",
  lg: "h-40 w-40 sm:h-52 sm:w-52",
};

export function JarvisRobot({
  presence,
  speaking = false,
  listening = false,
  thinking = false,
  size = "md",
  label = "Jarvis",
  className = "",
}: JarvisRobotProps) {
  const mode = speaking
    ? "speaking"
    : listening
      ? "listening"
      : thinking
        ? "thinking"
        : presence === "error"
          ? "error"
          : presence === "muted"
            ? "muted"
            : "idle";

  return (
    <div
      className={`jarvis-robot jarvis-robot--${mode} relative flex flex-col items-center gap-2 ${className}`}
      aria-live="polite"
      aria-label={`${label} is ${mode}`}
    >
      <div className={`relative ${sizeClass[size]}`}>
        <span className="jarvis-robot-ring" aria-hidden="true" />
        <span className="jarvis-robot-ring jarvis-robot-ring--delayed" aria-hidden="true" />
        <div className="jarvis-robot-shell relative h-full w-full overflow-hidden rounded-[28%] border border-white/15 bg-[#0b1018] shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <Image
            src="/jarvis/robot-portrait.jpg"
            alt=""
            fill
            sizes="(max-width: 640px) 10rem, 13rem"
            className="object-cover"
            priority={size !== "sm"}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#05070c]/90 to-transparent" />
          <div className="jarvis-robot-viseme" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      <div className="text-center">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">
          {label}
        </p>
        <p className="text-[10px] capitalize text-cyan-200/70">{mode}</p>
      </div>
    </div>
  );
}
