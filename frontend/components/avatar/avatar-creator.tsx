"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PersonAvatar } from "@/components/avatar/person-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  ACCESSORIES,
  BODY_SHAPES,
  BROW_STYLES,
  CLOTH_SWATCHES,
  EYE_SHAPES,
  EYE_SWATCHES,
  FACIAL_HAIR,
  GLASSES,
  GREETING_ANIMATIONS,
  GREETING_TEXT_MAX,
  HAIR_STYLES,
  HAIR_SWATCHES,
  HEAD_SHAPES,
  MOUTH_STYLES,
  OUTFITS,
  SKIN_SWATCHES,
  createDraft,
  defaultAvatar,
  parseAvatarConfig,
  parseGreetingAnimation,
  parseGreetingText,
  randomAvatar,
  replaceDraft,
  undoDraft,
  type AvatarConfig,
  type AvatarDraft,
  type GreetingAnimation,
} from "@/lib/avatar/config";
import { prefersStaticAvatars, type AvatarPrefs } from "@/lib/avatar/greeting";
import { readAvatarPrefs, readReducedMotion, speakGreeting, writeAvatarPrefs } from "@/lib/avatar/prefs";
import { useI18n } from "@/lib/i18n/locale";

const CHOICES: Array<{ key: keyof AvatarConfig; labelKey: "avatar.body" | "avatar.head" | "avatar.hair" | "avatar.eyes" | "avatar.brows" | "avatar.mouth" | "avatar.facialHair" | "avatar.glasses" | "avatar.accessory" | "avatar.outfit"; options: readonly string[] }> = [
  { key: "body", labelKey: "avatar.body", options: BODY_SHAPES },
  { key: "head", labelKey: "avatar.head", options: HEAD_SHAPES },
  { key: "hair", labelKey: "avatar.hair", options: HAIR_STYLES },
  { key: "eyes", labelKey: "avatar.eyes", options: EYE_SHAPES },
  { key: "brows", labelKey: "avatar.brows", options: BROW_STYLES },
  { key: "mouth", labelKey: "avatar.mouth", options: MOUTH_STYLES },
  { key: "facialHair", labelKey: "avatar.facialHair", options: FACIAL_HAIR },
  { key: "glasses", labelKey: "avatar.glasses", options: GLASSES },
  { key: "accessory", labelKey: "avatar.accessory", options: ACCESSORIES },
  { key: "outfit", labelKey: "avatar.outfit", options: OUTFITS },
];

function Swatches({ label, value, colors, onChange }: { label: string; value: string; colors: string[]; onChange: (color: string) => void }) {
  return (
    <div>
      <p className="text-xs font-medium text-(--muted)">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={value === color}
            className={`size-7 rounded-full border ${value === color ? "border-(--foreground) ring-2 ring-(--accent)" : "border-black/10"}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}

export function AvatarCreator() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [draft, setDraft] = useState<AvatarDraft>(() => createDraft(defaultAvatar()));
  const [greeting, setGreeting] = useState("");
  const [animation, setAnimation] = useState<GreetingAnimation>("wave");
  const [preview, setPreview] = useState(false);
  const [prefs, setPrefs] = useState<AvatarPrefs>({ staticAvatars: false, speakGreetings: false });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const user = me.data?.user;
  const serverKey = user
    ? `${user.id}|${JSON.stringify(user.avatarConfig ?? null)}|${user.greetingText ?? ""}|${user.greetingAnimation ?? ""}`
    : "";
  const [seenKey, setSeenKey] = useState("");
  if (serverKey && serverKey !== seenKey) {
    setSeenKey(serverKey);
    setDraft(createDraft(parseAvatarConfig(user?.avatarConfig) ?? defaultAvatar()));
    setGreeting(parseGreetingText(user?.greetingText) ?? "");
    setAnimation(parseGreetingAnimation(user?.greetingAnimation) ?? "wave");
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPrefs(readAvatarPrefs());
      setReducedMotion(readReducedMotion());
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const save = useMutation({
    mutationFn: () => api.updateAvatar({
      avatarConfig: draft.current,
      greetingText: greeting.trim() ? greeting.trim() : null,
      greetingAnimation: animation,
    }),
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
    },
    onError: (cause) => {
      setSaved(false);
      setError(cause instanceof Error ? cause.message : t("avatar.saveFailed"));
    },
  });

  function edit(patch: Partial<AvatarConfig>) {
    setSaved(false);
    setDraft((current) => replaceDraft(current, { ...current.current, ...patch }));
  }

  const staticAvatars = prefersStaticAvatars(prefs, reducedMotion);
  const config = draft.current;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[2rem] border border-(--line) bg-(--glass)">
          <PersonAvatar
            person={{ avatarConfig: config, displayName: me.data?.user.displayName }}
            size={220}
            focused
            staticAvatars={staticAvatars}
            animation={preview ? animation : "idle"}
            playing={!staticAvatars}
          />
        </div>
        {greeting.trim() && preview ? (
          <p role="status" className="mt-3 rounded-2xl bg-(--foreground) px-3 py-2 text-sm text-(--background)">{greeting.trim()}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setSaved(false); setDraft((current) => replaceDraft(current, randomAvatar())); }}>{t("avatar.randomize")}</Button>
          <Button type="button" variant="outline" disabled={draft.past.length === 0} onClick={() => setDraft((current) => undoDraft(current))}>{t("avatar.undo")}</Button>
          <Button type="button" variant="outline" onClick={() => { setPreview(true); if (prefs.speakGreetings && greeting.trim()) speakGreeting(greeting.trim()); }}>{t("avatar.preview")}</Button>
        </div>
      </div>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm leading-relaxed text-(--muted)">{t("avatar.privacy")}</p>
        {CHOICES.map((choice) => (
          <fieldset key={choice.key}>
            <legend className="text-xs font-medium text-(--muted)">{t(choice.labelKey)}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {choice.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={config[choice.key] === option}
                  className={`min-h-9 rounded-full px-3 text-xs ${config[choice.key] === option ? "bg-(--foreground) text-(--background)" : "border border-(--line) text-(--foreground)"}`}
                  onClick={() => edit({ [choice.key]: option } as Partial<AvatarConfig>)}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Swatches label={t("avatar.skin")} value={config.skin} colors={SKIN_SWATCHES} onChange={(skin) => edit({ skin })} />
          <Swatches label={t("avatar.hairColor")} value={config.hairColor} colors={HAIR_SWATCHES} onChange={(hairColor) => edit({ hairColor })} />
          <Swatches label={t("avatar.eyeColor")} value={config.eyeColor} colors={EYE_SWATCHES} onChange={(eyeColor) => edit({ eyeColor })} />
          <Swatches label={t("avatar.top")} value={config.top} colors={CLOTH_SWATCHES} onChange={(top) => edit({ top })} />
          <Swatches label={t("avatar.accent")} value={config.accent} colors={CLOTH_SWATCHES} onChange={(accent) => edit({ accent })} />
        </div>
        <label className="block">
          <span className="text-xs font-medium text-(--muted)">{t("avatar.greeting")}</span>
          <Input
            className="mt-2"
            maxLength={GREETING_TEXT_MAX}
            value={greeting}
            placeholder={t("avatar.greetingPlaceholder")}
            onChange={(event) => { setSaved(false); setGreeting(event.target.value.slice(0, GREETING_TEXT_MAX)); }}
          />
          <span className="mt-1 block text-xs text-(--muted)">{t("avatar.greetingHint")} {greeting.trim().length}/{GREETING_TEXT_MAX}</span>
        </label>
        <fieldset>
          <legend className="text-xs font-medium text-(--muted)">{t("avatar.animation")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {GREETING_ANIMATIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={animation === option}
                className={`min-h-9 rounded-full px-3 text-xs ${animation === option ? "bg-(--foreground) text-(--background)" : "border border-(--line)"}`}
                onClick={() => { setSaved(false); setAnimation(option); setPreview(true); }}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.staticAvatars}
            onChange={(event) => {
              const next = { ...prefs, staticAvatars: event.target.checked };
              setPrefs(next);
              writeAvatarPrefs(next);
            }}
          />
          <span>
            <span className="block font-medium">{t("avatar.static")}</span>
            <span className="text-(--muted)">{t("avatar.staticHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.speakGreetings}
            onChange={(event) => {
              const next = { ...prefs, speakGreetings: event.target.checked };
              setPrefs(next);
              writeAvatarPrefs(next);
            }}
          />
          <span>
            <span className="block font-medium">{t("avatar.speak")}</span>
            <span className="text-(--muted)">{t("avatar.speakHint")}</span>
          </span>
        </label>
        {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
        {saved ? <p role="status" className="text-sm text-(--muted)">{t("avatar.saved")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || me.isLoading}>{save.isPending ? t("avatar.saving") : t("avatar.save")}</Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              setSaved(false);
              api.updateAvatar({ avatarConfig: null, greetingText: null, greetingAnimation: null }).then(async () => {
                setGreeting("");
                setDraft(createDraft(defaultAvatar()));
                await queryClient.invalidateQueries({ queryKey: ["me"] });
                setSaved(true);
              }).catch((cause) => setError(cause instanceof Error ? cause.message : t("avatar.saveFailed")));
            }}
          >
            {t("avatar.clear")}
          </Button>
        </div>
      </form>
    </div>
  );
}
