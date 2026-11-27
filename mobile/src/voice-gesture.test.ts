import { describe, expect, it } from "vitest";
import { compactWave, meteringToLevel, voiceCancelArmed } from "./voice-gesture";

describe("voice note gestures", () => {
  it("cancels toward the leading edge so Arabic layouts slide the other way", () => {
    expect(voiceCancelArmed(-80, false)).toBe(true);
    expect(voiceCancelArmed(80, false)).toBe(false);
    expect(voiceCancelArmed(80, true)).toBe(true);
    expect(voiceCancelArmed(-80, true)).toBe(false);
  });

  it("turns microphone levels into a bounded waveform", () => {
    expect(meteringToLevel(-50)).toBe(0);
    expect(meteringToLevel(0)).toBe(1);
    const wave = compactWave([0, 0.5, 1, 0.5], 2);
    expect(wave).toHaveLength(2);
    expect(wave.every((level) => level >= 0 && level <= 1)).toBe(true);
  });
});
