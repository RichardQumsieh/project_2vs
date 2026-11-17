"use client";

import { SophiaRobot } from "@/components/sophia-robot";

export function SophiaRobotPreview() {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-[#0b1018]/80 p-6">
      <SophiaRobot presence="speaking" speaking size="lg" />
      <p className="mt-4 max-w-[14rem] text-center text-xs leading-relaxed text-white/45">
        Animated robot body used in chat. Speaking mode pulses the viseme while local TTS is active.
      </p>
    </div>
  );
}
