export type SuggestionCallbacks<T> = {
  onStart: (key: string) => void;
  onResult: (key: string, result: T) => void;
  onError: (key: string, error: Error) => void;
  onFinish: (key: string) => void;
};

export type SuggestionScheduler = {
  schedule<T>(
    key: string,
    task: (signal: AbortSignal) => Promise<T>,
    callbacks: SuggestionCallbacks<T>,
  ): void;
  cancel(): void;
};

export type SuggestionRetryGate = {
  claim(key: string): boolean;
};

export function createSuggestionRetryGate(
  maxRememberedKeys = 100,
): SuggestionRetryGate {
  const retried = new Set<string>();

  return {
    claim(key) {
      if (retried.has(key)) {
        return false;
      }
      retried.add(key);
      if (retried.size > maxRememberedKeys) {
        const oldestKey = retried.values().next().value;
        if (oldestKey !== undefined) {
          retried.delete(oldestKey);
        }
      }
      return true;
    },
  };
}

export function createSuggestionScheduler(
  delayMs = 650,
): SuggestionScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let generation = 0;

  function cancel() {
    generation += 1;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    controller?.abort();
    controller = undefined;
  }

  return {
    cancel,
    schedule<T>(
      key: string,
      task: (signal: AbortSignal) => Promise<T>,
      callbacks: SuggestionCallbacks<T>,
    ) {
      cancel();
      const currentGeneration = generation;
      timer = setTimeout(() => {
        timer = undefined;
        const currentController = new AbortController();
        controller = currentController;
        callbacks.onStart(key);

        void task(currentController.signal).then(
          (result) => {
            if (
              generation === currentGeneration &&
              !currentController.signal.aborted
            ) {
              callbacks.onResult(key, result);
            }
          },
          (error: unknown) => {
            if (
              generation === currentGeneration &&
              !currentController.signal.aborted &&
              !(error instanceof Error && error.name === "AbortError")
            ) {
              callbacks.onError(
                key,
                error instanceof Error
                  ? error
                  : new Error("Suggested replies could not be generated."),
              );
            }
          },
        ).finally(() => {
          if (generation === currentGeneration) {
            controller = undefined;
            callbacks.onFinish(key);
          }
        });
      }, delayMs);
    },
  };
}

export function latestIncomingMessageId(
  messages: Array<{ id: string; fromMe: boolean }>,
) {
  const latest = messages.at(-1);
  return latest && !latest.fromMe ? latest.id : null;
}
