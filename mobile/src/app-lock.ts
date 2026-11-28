export const LOCK_DELAYS = [0, 30_000, 60_000] as const;
export type LockDelayMs = (typeof LOCK_DELAYS)[number];
export const DEFAULT_LOCK_DELAY_MS: LockDelayMs = 60_000;

export type AppActivityState = "active" | "background" | "inactive" | "unknown" | "extension";

let currentDelay: LockDelayMs = DEFAULT_LOCK_DELAY_MS;
let externalDepth = 0;
const externalListeners = new Set<() => void>();

export function currentLockDelayMs(): LockDelayMs {
  return currentDelay;
}

export function setCurrentLockDelayMs(delay: LockDelayMs) {
  currentDelay = delay;
}

export function asActivityState(state: string | null | undefined): AppActivityState {
  if (
    state === "active" ||
    state === "background" ||
    state === "inactive" ||
    state === "unknown" ||
    state === "extension"
  ) {
    return state;
  }
  return "unknown";
}

export function parseLockDelayMs(value: string | null | undefined): LockDelayMs {
  if (value == null || value.trim() === "") return DEFAULT_LOCK_DELAY_MS;
  const parsed = Number(value);
  if (parsed === 0 || parsed === 30_000 || parsed === 60_000) return parsed;
  return DEFAULT_LOCK_DELAY_MS;
}

export function externalActivityActive() {
  return externalDepth > 0;
}

export function beginExternalActivity() {
  externalDepth += 1;
  externalListeners.forEach((listener) => listener());
}

export function endExternalActivity() {
  externalDepth = Math.max(0, externalDepth - 1);
  externalListeners.forEach((listener) => listener());
}

export async function withExternalActivity<T>(work: () => Promise<T>): Promise<T> {
  beginExternalActivity();
  try {
    return await work();
  } finally {
    endExternalActivity();
  }
}

export function subscribeExternalActivity(listener: () => void) {
  externalListeners.add(listener);
  return () => {
    externalListeners.delete(listener);
  };
}

export function resetExternalActivityForTests() {
  externalDepth = 0;
  externalListeners.clear();
  currentDelay = DEFAULT_LOCK_DELAY_MS;
}

/**
 * Decide when a background transition should lock the vault.
 * System pickers and permission dialogs set `externalActivity` and must not lock.
 * Time spent in that flow is not counted toward the grace period.
 */
export function lockSchedule(input: {
  state: AppActivityState;
  now: number;
  backgroundedAt: number | null;
  delayMs: number;
  externalActivity: boolean;
}): { backgroundedAt: number | null; lockAt: number | null } {
  if (input.state === "active" || input.externalActivity) {
    return { backgroundedAt: null, lockAt: null };
  }
  const backgroundedAt = input.backgroundedAt ?? input.now;
  return { backgroundedAt, lockAt: backgroundedAt + Math.max(0, input.delayMs) };
}

export function createLockController(deps: {
  now: () => number;
  delayMs: () => number;
  externalActivity: () => boolean;
  appState: () => AppActivityState;
  onLock: () => void;
  schedule: (lockAt: number, fire: () => void) => () => void;
}) {
  let backgroundedAt: number | null = null;
  let cancel: (() => void) | null = null;
  let locked = false;

  function clear() {
    cancel?.();
    cancel = null;
  }

  function evaluate(state: AppActivityState = deps.appState()) {
    if (locked) return;
    clear();
    const decision = lockSchedule({
      state,
      now: deps.now(),
      backgroundedAt,
      delayMs: deps.delayMs(),
      externalActivity: deps.externalActivity(),
    });
    backgroundedAt = decision.backgroundedAt;
    if (decision.lockAt == null) return;
    const fire = () => {
      cancel = null;
      if (locked) return;
      if (deps.externalActivity() || deps.appState() === "active") {
        evaluate(deps.appState());
        return;
      }
      locked = true;
      backgroundedAt = null;
      deps.onLock();
    };
    if (decision.lockAt <= deps.now()) {
      fire();
      return;
    }
    cancel = deps.schedule(decision.lockAt, fire);
  }

  return {
    evaluate,
    dispose() {
      clear();
    },
  };
}
