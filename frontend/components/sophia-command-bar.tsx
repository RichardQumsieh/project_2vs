"use client";

import { ExperimentalBadge } from "@/components/experimental-badge";
import { useAgentRunner, type AgentRunnerMode } from "@/lib/ai/agent-runner";
import { useI18n } from "@/lib/i18n/locale";

export function SophiaCommandBar({
  mode,
  className = "",
  loadChatExcerpt,
}: {
  mode: AgentRunnerMode;
  className?: string;
  loadChatExcerpt?: () => Promise<string | null>;
}) {
  const { t, setLocale } = useI18n();
  const runner = useAgentRunner({ mode, onLocale: setLocale, loadChatExcerpt });

  return (
    <form
      className={`sophia-command min-w-0 space-y-2 ${className}`.trim()}
      aria-label={t("agent.bar.label")}
      onSubmit={(event) => {
        event.preventDefault();
        void runner.submit();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-white">{t("agent.bar.label")}</p>
        <ExperimentalBadge />
      </div>
      <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label={t("agent.autonomy")}>
        <button
          type="button"
          aria-pressed={runner.autonomy === "full_control"}
          className={`min-h-11 rounded-full px-3 text-sm ${runner.autonomy === "full_control" ? "bg-white text-black" : "border border-white/15 text-white/80"}`}
          onClick={() => runner.setAutonomy("full_control")}
        >
          {t("agent.fullControl")}
        </button>
        <button
          type="button"
          aria-pressed={runner.autonomy === "ask_first"}
          className={`min-h-11 rounded-full px-3 text-sm ${runner.autonomy === "ask_first" ? "bg-white text-black" : "border border-white/15 text-white/80"}`}
          onClick={() => runner.setAutonomy("ask_first")}
        >
          {t("agent.askFirst")}
        </button>
      </div>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-5 text-white/80">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0"
          checked={runner.readChats}
          onChange={(event) => runner.setReadChats(event.target.checked)}
        />
        <span>
          <span className="font-medium text-white">{t("agent.readChats")}</span>
          <span className="mt-0.5 block text-xs text-white/55">{t("agent.readChatsHint")}</span>
        </span>
      </label>
      <label className="block min-w-0 text-sm text-white/80">
        <input
          value={runner.command}
          onChange={(event) => runner.setCommand(event.target.value)}
          placeholder={t("agent.command.placeholder")}
          aria-label={t("agent.command.label")}
          className="min-h-11 w-full min-w-0 rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-sm text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
        />
      </label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <button
          type="submit"
          disabled={runner.running || !runner.command.trim()}
          className="min-h-11 rounded-full bg-cyan-200 px-4 text-sm font-medium text-black disabled:opacity-50"
        >
          {t("agent.submit")}
        </button>
        <button
          type="button"
          onClick={runner.stop}
          className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-white"
        >
          {t("agent.stop")}
        </button>
        <label className="inline-flex min-h-11 min-w-0 cursor-pointer items-center rounded-full border border-white/15 px-3 text-sm text-white/80">
          <span className="truncate">{runner.file ? runner.file.name : t("agent.file")}</span>
          <input
            type="file"
            className="hidden"
            onChange={(event) => runner.setFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      {runner.notice ? <p className="text-sm text-amber-100/90" role="status">{runner.notice}</p> : null}
      {runner.text && runner.text !== "Done." ? <p dir="auto" className="text-sm leading-6 text-white/80" role="status">{runner.text}</p> : null}
      {runner.steps.length > 0 ? (
        <ol className="max-h-48 min-w-0 space-y-2 overflow-y-auto" aria-live="polite">
          {runner.steps.map((step) => (
            <li key={step.id} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm">
              <p dir="auto" className="break-words text-white/80">{step.summary}</p>
              {step.display ? (
                <a className="mt-1 block truncate text-cyan-100 underline" href={step.display} dir="ltr">
                  {t("agent.openLink")}
                </a>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {step.status === "confirmed" ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-full bg-white px-3 text-sm text-black"
                    onClick={() => void runner.confirm(step)}
                  >
                    {t("agent.confirm")}
                  </button>
                ) : null}
                {step.undo && step.status === "executed" ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-full border border-white/15 px-3 text-sm text-white"
                    onClick={() => void runner.undo(step)}
                  >
                    {t("agent.undo")}
                  </button>
                ) : null}
                {step.status === "undone" ? <span className="text-xs text-white/50">{t("agent.undone")}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </form>
  );
}
