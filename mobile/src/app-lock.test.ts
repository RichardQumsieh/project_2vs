import { beforeEach, describe, expect, it } from "vitest";
import {
  beginExternalActivity,
  createLockController,
  endExternalActivity,
  externalActivityActive,
  lockSchedule,
  parseLockDelayMs,
  resetExternalActivityForTests,
  subscribeExternalActivity,
  withExternalActivity,
  type AppActivityState,
} from "./app-lock";

beforeEach(() => {
  resetExternalActivityForTests();
});

describe("lock schedule", () => {
  it("keeps the default delay inside the 30–60 second window and accepts immediate", () => {
    expect(parseLockDelayMs(null)).toBe(60_000);
    expect(parseLockDelayMs("0")).toBe(0);
    expect(parseLockDelayMs("30000")).toBe(30_000);
    expect(parseLockDelayMs("45000")).toBe(60_000);
  });

  it("does not lock while the app is active", () => {
    expect(lockSchedule({
      state: "active",
      now: 1_000,
      backgroundedAt: 500,
      delayMs: 0,
      externalActivity: false,
    })).toEqual({ backgroundedAt: null, lockAt: null });
  });

  it("locks immediately only when that option is selected", () => {
    expect(lockSchedule({
      state: "background",
      now: 5_000,
      backgroundedAt: null,
      delayMs: 0,
      externalActivity: false,
    }).lockAt).toBe(5_000);
  });

  it("waits out the grace period after background or inactive", () => {
    const background = lockSchedule({
      state: "background",
      now: 10_000,
      backgroundedAt: null,
      delayMs: 60_000,
      externalActivity: false,
    });
    expect(background).toEqual({ backgroundedAt: 10_000, lockAt: 70_000 });
    const later = lockSchedule({
      state: "inactive",
      now: 20_000,
      backgroundedAt: background.backgroundedAt,
      delayMs: 30_000,
      externalActivity: false,
    });
    expect(later.lockAt).toBe(40_000);
  });

  it("suppresses the lock for a picker, camera, or permission flow we launched", () => {
    beginExternalActivity();
    expect(externalActivityActive()).toBe(true);
    expect(lockSchedule({
      state: "inactive",
      now: 8_000,
      backgroundedAt: 1_000,
      delayMs: 0,
      externalActivity: true,
    })).toEqual({ backgroundedAt: null, lockAt: null });
    endExternalActivity();
    expect(externalActivityActive()).toBe(false);
  });
});

describe("lock controller", () => {
  function harness(delayMs: number, external = () => false) {
    let now = 1_000;
    let state: AppActivityState = "active";
    const locks: number[] = [];
    let pending: { at: number; fire: () => void } | null = null;
    const controller = createLockController({
      now: () => now,
      delayMs: () => delayMs,
      externalActivity: external,
      appState: () => state,
      onLock: () => locks.push(now),
      schedule: (at, fire) => {
        pending = { at, fire };
        return () => {
          pending = null;
        };
      },
    });
    return {
      controller,
      locks,
      setNow: (value: number) => {
        now = value;
      },
      setState: (value: AppActivityState) => {
        state = value;
      },
      pending: () => pending,
    };
  }

  it("locks only after the grace period and not one millisecond earlier", () => {
    const clock = harness(60_000);
    clock.setState("background");
    clock.controller.evaluate("background");
    expect(clock.locks).toEqual([]);
    expect(clock.pending()?.at).toBe(61_000);
    clock.setNow(60_999);
    clock.setNow(61_000);
    clock.pending()?.fire();
    expect(clock.locks).toEqual([61_000]);
  });

  it("cancels the pending lock when the app returns", () => {
    const clock = harness(30_000);
    clock.setState("inactive");
    clock.controller.evaluate("inactive");
    expect(clock.pending()?.at).toBe(31_000);
    clock.setState("active");
    clock.controller.evaluate("active");
    expect(clock.pending()).toBeNull();
    expect(clock.locks).toEqual([]);
  });

  it("does not lock when a system picker is the reason the app went inactive", () => {
    let external = false;
    const clock = harness(0, () => external);
    external = true;
    clock.setState("inactive");
    clock.controller.evaluate("inactive");
    expect(clock.locks).toEqual([]);
    expect(clock.pending()).toBeNull();
    external = false;
    clock.setState("active");
    clock.controller.evaluate("active");
    expect(clock.locks).toEqual([]);
  });

  it("locks immediately in that mode once the app is really in the background", () => {
    const clock = harness(0);
    clock.setState("background");
    clock.controller.evaluate("background");
    expect(clock.locks).toEqual([1_000]);
  });

  it("drops a scheduled lock if a picker is open when the timer fires", () => {
    let external = false;
    const clock = harness(30_000, () => external);
    clock.setState("background");
    clock.controller.evaluate("background");
    external = true;
    clock.setNow(31_000);
    clock.pending()?.fire();
    expect(clock.locks).toEqual([]);
  });
});

describe("external activity flag", () => {
  it("nests and notifies listeners", async () => {
    let calls = 0;
    const unsubscribe = subscribeExternalActivity(() => {
      calls += 1;
    });
    await withExternalActivity(async () => {
      expect(externalActivityActive()).toBe(true);
      beginExternalActivity();
      expect(externalActivityActive()).toBe(true);
      endExternalActivity();
    });
    expect(externalActivityActive()).toBe(false);
    expect(calls).toBe(4);
    unsubscribe();
  });
});
