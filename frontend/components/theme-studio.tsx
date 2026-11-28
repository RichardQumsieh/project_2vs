"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n/locale";
import { wallpaperDataUri } from "@/lib/themes/wallpaper";
import {
  parseGeneratedTheme,
  readSavedTheme,
  type GeneratedTheme,
  type SavedTheme,
} from "@/lib/themes/tokens";
import { useGeneratedTheme } from "@/components/generated-theme-provider";

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function Preview({ theme }: { theme: GeneratedTheme }) {
  const wallpaper = useMemo(() => {
    try {
      return wallpaperDataUri(theme.wallpaper);
    } catch {
      return null;
    }
  }, [theme]);
  const palette = theme.light;
  return (
    <div
      className="overflow-hidden rounded-3xl border border-white/10"
      style={{
        backgroundImage: wallpaper ? `linear-gradient(rgba(0,0,0,.28), rgba(0,0,0,.28)), url("${wallpaper}")` : undefined,
        backgroundColor: palette.background,
        backgroundSize: "cover",
        borderRadius: theme.cornerRadius,
      }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ color: palette.text }}>
        <strong>{theme.emoji} {theme.name}</strong>
        <span style={{ color: theme.iconAccent }}>●</span>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm" style={{ background: palette.bubbleTheirs, color: palette.textOnTheirs, borderRadius: theme.cornerRadius }}>
          A message from someone else
        </div>
        <div className="ms-auto max-w-[80%] rounded-2xl px-3 py-2 text-sm" style={{ background: palette.bubbleMine, color: palette.textOnMine, borderRadius: theme.cornerRadius, fontWeight: theme.fontWeight === "bold" ? 700 : theme.fontWeight === "semibold" ? 600 : 500 }}>
          Your reply stays on this device
        </div>
      </div>
    </div>
  );
}

export function ThemeStudio() {
  const { t } = useI18n();
  const themes = useGeneratedTheme();
  const [prompt, setPrompt] = useState("Spider-Man, Tom Holland");
  const [tweak, setTweak] = useState("");
  const [draft, setDraft] = useState<GeneratedTheme | null>(null);
  const [adjustments, setAdjustments] = useState(0);
  const [source, setSource] = useState<"model" | "mock" | null>(null);
  const [mine, setMine] = useState<SavedTheme[]>([]);
  const [gallery, setGallery] = useState<SavedTheme[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadLists(search = query) {
    const [owned, community] = await Promise.all([
      api.myThemes(),
      api.themeGallery(search.trim() ? { q: search.trim() } : undefined),
    ]);
    setMine(owned.themes.flatMap((theme) => {
      const saved = readSavedTheme(theme);
      return saved ? [saved] : [];
    }));
    setGallery(community.themes.flatMap((theme) => {
      const saved = readSavedTheme(theme);
      return saved ? [saved] : [];
    }));
  }

  useEffect(() => {
    void loadLists().catch((cause) => setError(message(cause)));
    // The first gallery load does not depend on later searches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setBusy("generate");
    setError("");
    setNotice("");
    try {
      const result = await api.generateTheme({
        prompt,
        ...(tweak.trim() ? { tweak: tweak.trim() } : {}),
        ...(draft ? { previous: draft } : {}),
      });
      const theme = parseGeneratedTheme(result.theme);
      if (!theme) throw new Error("The theme could not be previewed.");
      setDraft(theme);
      setAdjustments(result.adjustments.length);
      setSource(result.source);
      themes.setPreview(theme);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setError("");
    try {
      await api.saveTheme({ prompt, theme: draft });
      await loadLists();
      setNotice(t("themes.saved"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  async function apply(themeId: string, scope: "app" | "chat") {
    setBusy(themeId + scope);
    setError("");
    try {
      let conversationId: string | undefined;
      if (scope === "chat") {
        const entered = window.prompt(t("themes.chatPrompt"))?.trim();
        if (!entered) return;
        conversationId = entered;
      }
      await api.applyTheme({ themeId, scope, conversationId, wallpaperOnly: scope === "chat" });
      await themes.refresh();
      setNotice(scope === "app" ? t("themes.appliedApp") : t("themes.appliedChat"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        <label className="block text-sm">
          {t("themes.prompt")}
          <textarea
            value={prompt}
            maxLength={180}
            onChange={(event) => setPrompt(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          {t("themes.tweak")}
          <input
            value={tweak}
            maxLength={120}
            placeholder={t("themes.tweakPlaceholder")}
            onChange={(event) => setTweak(event.target.value)}
            className="mt-1 h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-full bg-white px-4 py-2 text-sm text-black" onClick={() => void generate()} disabled={busy === "generate" || !prompt.trim()}>
            {draft ? t("themes.regenerate") : t("themes.generate")}
          </button>
          <button type="button" className="rounded-full border border-white/20 px-4 py-2 text-sm" onClick={() => void save()} disabled={!draft || busy === "save"}>
            {t("themes.save")}
          </button>
        </div>
        {source ? <p className="text-xs text-white/55">{source === "mock" ? t("themes.mock") : t("themes.model")} {adjustments > 0 ? t("themes.adjusted") : ""}</p> : null}
        {draft ? <Preview theme={draft} /> : <p className="text-sm text-white/60">{t("themes.previewEmpty")}</p>}
      </section>

      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-emerald-100">{notice}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg">{t("themes.mine")}</h2>
        <ThemeList themes={mine} busy={busy} onApply={apply} onPublish={async (theme) => {
          await api.publishTheme(theme.id, !theme.published);
          await loadLists();
        }} onDelete={async (theme) => {
          await api.deleteTheme(theme.id);
          await loadLists();
          await themes.refresh();
        }} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg">{t("themes.gallery")}</h2>
        <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          void loadLists(query).catch((cause) => setError(message(cause)));
        }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("themes.search")} className="h-11 flex-1 rounded-2xl border border-white/10 bg-black/20 px-3" />
          <button type="submit" className="rounded-full border border-white/20 px-4">{t("themes.searchAction")}</button>
        </form>
        <ThemeList themes={gallery} busy={busy} onApply={apply} onInstall={async (theme) => {
          const installed = readSavedTheme(await api.installTheme(theme.id));
          await loadLists();
          if (installed) setNotice(t("themes.installed"));
        }} onLike={async (theme) => {
          if (theme.liked) await api.unlikeTheme(theme.id);
          else await api.likeTheme(theme.id);
          await loadLists();
        }} onReport={async (theme) => {
          await api.reportTheme(theme.id, "other");
          setNotice(t("themes.reported"));
        }} />
      </section>
    </div>
  );
}

function ThemeList({
  themes,
  busy,
  onApply,
  onPublish,
  onDelete,
  onInstall,
  onLike,
  onReport,
}: {
  themes: SavedTheme[];
  busy: string;
  onApply: (id: string, scope: "app" | "chat") => Promise<void>;
  onPublish?: (theme: SavedTheme) => Promise<void>;
  onDelete?: (theme: SavedTheme) => Promise<void>;
  onInstall?: (theme: SavedTheme) => Promise<void>;
  onLike?: (theme: SavedTheme) => Promise<void>;
  onReport?: (theme: SavedTheme) => Promise<void>;
}) {
  const { t } = useI18n();
  if (themes.length === 0) return <p className="text-sm text-white/55">{t("themes.empty")}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {themes.map((theme) => (
        <li key={theme.id} className="space-y-2 rounded-3xl border border-white/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <strong>{theme.emoji} {theme.name}</strong>
            <span className="text-xs text-white/50">{theme.likeCount}</span>
          </div>
          {theme.flagged ? <p className="text-xs text-amber-100">{t("themes.flagged")}</p> : null}
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="rounded-full border border-white/15 px-3 py-1" disabled={Boolean(busy)} onClick={() => void onApply(theme.id, "app")}>{t("themes.applyApp")}</button>
            <button type="button" className="rounded-full border border-white/15 px-3 py-1" disabled={Boolean(busy)} onClick={() => void onApply(theme.id, "chat")}>{t("themes.applyChat")}</button>
            {onPublish ? <button type="button" className="rounded-full border border-white/15 px-3 py-1" onClick={() => void onPublish(theme)}>{theme.published ? t("themes.unpublish") : t("themes.publish")}</button> : null}
            {onDelete ? <button type="button" className="rounded-full border border-white/15 px-3 py-1" onClick={() => void onDelete(theme)}>{t("themes.delete")}</button> : null}
            {onInstall && !theme.mine ? <button type="button" className="rounded-full border border-white/15 px-3 py-1" onClick={() => void onInstall(theme)}>{t("themes.install")}</button> : null}
            {onLike ? <button type="button" className="rounded-full border border-white/15 px-3 py-1" onClick={() => void onLike(theme)}>{theme.liked ? t("themes.unlike") : t("themes.like")}</button> : null}
            {onReport && !theme.mine ? <button type="button" className="rounded-full border border-white/15 px-3 py-1" onClick={() => void onReport(theme)}>{t("themes.report")}</button> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
