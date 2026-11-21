"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppearance } from "@/components/appearance-provider";
import { CURATED_DATA_URI, GRADIENT_CSS } from "@/lib/appearance/backgrounds";
import {
  emptyPanelUses,
  type AdaptationRuleId,
  type PanelId,
} from "@/lib/appearance/engine";
import { parseAppearanceTokens, type AppearanceTokens } from "@/lib/appearance/schema";
import { activeTokens, activeVoice } from "@/lib/appearance/store";
import { ACCENT_SWATCHES } from "@/lib/appearance/tokens";
import {
  composeMeetingDraft,
  type VoiceLanguage,
  type VoiceManner,
  type VoicePreferences,
  type VoiceVerbosity,
} from "@/lib/appearance/voice";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const proposalKeys: Record<AdaptationRuleId, MessageKey> = {
  "evening-calm": "appearance.proposalEvening",
  "morning-crisp": "appearance.proposalMorning",
  "family-warm": "appearance.proposalFamily",
  "arabic-drafts": "appearance.proposalArabic",
  "reading-room": "appearance.proposalReading",
};

const revisionKeys: Record<"default" | "user" | "proposal" | "reset", MessageKey> = {
  default: "appearance.revisionDefault",
  user: "appearance.revisionUser",
  proposal: "appearance.revisionProposal",
  reset: "appearance.revisionReset",
};

export function AppearanceStudio({
  hour,
  role,
  topPanel,
}: {
  hour?: number;
  role?: "manager" | "family";
  topPanel?: PanelId;
}) {
  const { t, locale } = useI18n();
  const appearance = useAppearance();
  const tokens = appearance.preview?.tokens ?? activeTokens(appearance.record);
  const voice = appearance.preview?.voice ?? activeVoice(appearance.record);
  const [accentText, setAccentText] = useState(tokens.accent);
  const [accentInvalid, setAccentInvalid] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setAccentText(tokens.accent);
    setAccentInvalid(false);
  }, [tokens.accent]);

  useEffect(() => {
    if (role && role !== appearance.record.role) appearance.setRole(role);
  }, [appearance, role]);

  const signals = useMemo(() => {
    const panelUses = topPanel
      ? { ...emptyPanelUses(), [topPanel]: 6 }
      : appearance.panelUses;
    return {
      locale,
      hour: hour ?? new Date().getHours(),
      role: role ?? appearance.record.role,
      panelUses,
    };
  }, [appearance.panelUses, appearance.record.role, hour, locale, role, topPanel]);

  useEffect(() => {
    if (!appearance.enabled || appearance.preview) return;
    appearance.refreshProposal(signals);
  }, [appearance, signals]);

  if (!appearance.enabled) {
    return (
      <section className="appearance-card">
        <h2>{t("appearance.offTitle")}</h2>
        <p>{t("appearance.offBody")}</p>
      </section>
    );
  }

  const pending = appearance.record.pending;
  const sample = composeMeetingDraft({
    purpose: "align on next steps",
    when: "Wednesday",
    voice,
  });

  function commit(nextTokens: AppearanceTokens, nextVoice: VoicePreferences = voice) {
    const parsed = parseAppearanceTokens(nextTokens);
    if (!parsed.ok) {
      setAccentInvalid(true);
      return;
    }
    setAccentInvalid(false);
    appearance.update(parsed.tokens, nextVoice);
  }

  return (
    <div className="appearance-studio">
      <p className="appearance-note">{t("appearance.localOnly")}</p>
      {pending ? (
        <article className="appearance-card appearance-proposal" aria-label={t("appearance.proposalLabel")}>
          <p className="appearance-proposal-copy">{t(proposalKeys[pending.ruleId])}</p>
          <div className="appearance-actions">
            <button type="button" className="appearance-choice" title={t("appearance.preview")} aria-label={t("appearance.preview")} onClick={() => appearance.setPreview({ tokens: pending.tokens, voice: pending.voice })}>
              {t("appearance.preview")}
            </button>
            <button type="button" className="appearance-choice appearance-choice-primary" title={t("appearance.approve")} aria-label={t("appearance.approve")} onClick={appearance.approve}>
              {t("appearance.approve")}
            </button>
            <button type="button" className="appearance-choice" title={t("appearance.dismiss")} aria-label={t("appearance.dismiss")} onClick={appearance.dismiss}>
              {t("appearance.dismiss")}
            </button>
          </div>
        </article>
      ) : null}
      {appearance.preview ? (
        <p className="appearance-status" role="status">
          {t("appearance.previewing")}{" "}
          <button type="button" className="appearance-choice" title={t("appearance.cancelPreview")} aria-label={t("appearance.cancelPreview")} onClick={() => appearance.setPreview(null)}>
            {t("appearance.cancelPreview")}
          </button>
        </p>
      ) : null}
      <section className="appearance-card" aria-label={t("appearance.draftSample")}>
        <h2>{t("appearance.draftSample")}</h2>
        <p className="appearance-draft" dir="auto">{sample}</p>
      </section>
      <section className="appearance-card">
        <ChoiceRow label={t("appearance.colorMode")}>
          {(["system", "light", "dark"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="appearance-choice"
              title={t(mode === "system" ? "appearance.system" : mode === "light" ? "appearance.light" : "appearance.dark")}
              aria-label={t(mode === "system" ? "appearance.system" : mode === "light" ? "appearance.light" : "appearance.dark")}
              aria-pressed={tokens.colorMode === mode}
              onClick={() => commit({ ...tokens, colorMode: mode })}
            >
              {t(mode === "system" ? "appearance.system" : mode === "light" ? "appearance.light" : "appearance.dark")}
            </button>
          ))}
        </ChoiceRow>
        <ChoiceRow label={t("appearance.density")}>
          {(["compact", "comfortable", "spacious"] as const).map((density) => (
            <button
              key={density}
              type="button"
              className="appearance-choice"
              title={t(density === "compact" ? "appearance.densityCompact" : density === "comfortable" ? "appearance.densityComfortable" : "appearance.densitySpacious")}
              aria-label={t(density === "compact" ? "appearance.densityCompact" : density === "comfortable" ? "appearance.densityComfortable" : "appearance.densitySpacious")}
              aria-pressed={tokens.density === density}
              onClick={() => commit({ ...tokens, density })}
            >
              {t(
                density === "compact"
                  ? "appearance.densityCompact"
                  : density === "comfortable"
                    ? "appearance.densityComfortable"
                    : "appearance.densitySpacious",
              )}
            </button>
          ))}
        </ChoiceRow>
        <div className="appearance-field">
          <label htmlFor="appearance-font-scale">{t("appearance.fontScale")}</label>
          <input
            id="appearance-font-scale"
            type="range"
            min={0.875}
            max={1.25}
            step={0.0625}
            value={tokens.fontScale}
            onChange={(event) => commit({ ...tokens, fontScale: Number(event.currentTarget.value) })}
          />
        </div>
        <div className="appearance-field">
          <span id="appearance-accent-label">{t("appearance.accent")}</span>
          <div className="appearance-swatches" role="group" aria-labelledby="appearance-accent-label">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="appearance-swatch"
                style={{ background: swatch }}
                aria-label={swatch}
                aria-pressed={tokens.accent === swatch}
                onClick={() => commit({ ...tokens, accent: swatch })}
              />
            ))}
          </div>
          <label className="appearance-hex" htmlFor="appearance-accent">
            <span className="sr-only">{t("appearance.accent")}</span>
            <input
              id="appearance-accent"
              value={accentText}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setAccentText(value);
                if (/^#[0-9a-fA-F]{6}$/.test(value)) commit({ ...tokens, accent: value });
              }}
            />
          </label>
          {accentInvalid || appearance.issue === "contrast" ? (
            <p role="alert">{t("appearance.accentInvalid")}</p>
          ) : null}
        </div>
      </section>
      <section className="appearance-card">
        <h2>{t("appearance.background")}</h2>
        <div className="appearance-backgrounds" role="group" aria-label={t("appearance.background")}>
          <BackgroundButton
            label={t("appearance.backgroundNone")}
            pressed={tokens.background.kind === "none"}
            onClick={() => commit({ ...tokens, background: { kind: "none" } })}
          />
          {(Object.keys(GRADIENT_CSS) as Array<keyof typeof GRADIENT_CSS>).map((id) => (
            <BackgroundButton
              key={id}
              label={t(gradientLabel(id))}
              pressed={tokens.background.kind === "gradient" && tokens.background.id === id}
              image={GRADIENT_CSS[id]}
              onClick={() => commit({ ...tokens, background: { kind: "gradient", id } })}
            />
          ))}
          {(Object.keys(CURATED_DATA_URI) as Array<keyof typeof CURATED_DATA_URI>).map((id) => (
            <BackgroundButton
              key={id}
              label={t(curatedLabel(id))}
              pressed={tokens.background.kind === "curated" && tokens.background.id === id}
              image={`url("${CURATED_DATA_URI[id]}")`}
              onClick={() => commit({ ...tokens, background: { kind: "curated", id } })}
            />
          ))}
        </div>
        <label className="appearance-upload" title={t("appearance.upload")} aria-label={t("appearance.upload")}>
          {t("appearance.upload")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            title={t("appearance.upload")}
            aria-label={t("appearance.upload")}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void appearance.uploadBackground(file);
            }}
          />
        </label>
        <p className="appearance-hint">{t("appearance.uploadHint")}</p>
        {tokens.background.kind === "upload" ? (
          <button type="button" className="appearance-choice" title={t("appearance.removeUpload")} aria-label={t("appearance.removeUpload")} onClick={() => commit({ ...tokens, background: { kind: "none" } })}>
            {t("appearance.removeUpload")}
          </button>
        ) : null}
        {appearance.issue === "upload" ? <p role="alert">{t("appearance.uploadInvalid")}</p> : null}
      </section>
      <section className="appearance-card">
        <h2>{t("appearance.voice")}</h2>
        <ChoiceRow label={t("appearance.role")}>
          {(["manager", "family"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="appearance-choice"
              title={t(item === "manager" ? "appearance.roleManager" : "appearance.roleFamily")}
              aria-label={t(item === "manager" ? "appearance.roleManager" : "appearance.roleFamily")}
              aria-pressed={appearance.record.role === item}
              onClick={() => appearance.setRole(item)}
            >
              {t(item === "manager" ? "appearance.roleManager" : "appearance.roleFamily")}
            </button>
          ))}
        </ChoiceRow>
        <ChoiceRow label={t("appearance.manner")}>
          {(["formal", "friendly"] as const satisfies readonly VoiceManner[]).map((manner) => (
            <button
              key={manner}
              type="button"
              className="appearance-choice"
              title={t(manner === "formal" ? "appearance.mannerFormal" : "appearance.mannerFriendly")}
              aria-label={t(manner === "formal" ? "appearance.mannerFormal" : "appearance.mannerFriendly")}
              aria-pressed={voice.manner === manner}
              onClick={() => commit(tokens, { ...voice, manner })}
            >
              {t(manner === "formal" ? "appearance.mannerFormal" : "appearance.mannerFriendly")}
            </button>
          ))}
        </ChoiceRow>
        <ChoiceRow label={t("appearance.verbosity")}>
          {(["short", "detailed"] as const satisfies readonly VoiceVerbosity[]).map((verbosity) => (
            <button
              key={verbosity}
              type="button"
              className="appearance-choice"
              title={t(verbosity === "short" ? "appearance.verbosityShort" : "appearance.verbosityDetailed")}
              aria-label={t(verbosity === "short" ? "appearance.verbosityShort" : "appearance.verbosityDetailed")}
              aria-pressed={voice.verbosity === verbosity}
              onClick={() => commit(tokens, { ...voice, verbosity })}
            >
              {t(verbosity === "short" ? "appearance.verbosityShort" : "appearance.verbosityDetailed")}
            </button>
          ))}
        </ChoiceRow>
        <ChoiceRow label={t("appearance.draftLanguage")}>
          {(["english", "arabic", "mixed"] as const satisfies readonly VoiceLanguage[]).map((language) => (
            <button
              key={language}
              type="button"
              className="appearance-choice"
              title={t(language === "english" ? "appearance.langEnglish" : language === "arabic" ? "appearance.langArabic" : "appearance.langMixed")}
              aria-label={t(language === "english" ? "appearance.langEnglish" : language === "arabic" ? "appearance.langArabic" : "appearance.langMixed")}
              aria-pressed={voice.language === language}
              onClick={() => commit(tokens, { ...voice, language })}
            >
              {t(
                language === "english"
                  ? "appearance.langEnglish"
                  : language === "arabic"
                    ? "appearance.langArabic"
                    : "appearance.langMixed",
              )}
            </button>
          ))}
        </ChoiceRow>
      </section>
      <section className="appearance-card">
        <div className="appearance-actions">
          <button type="button" className="appearance-choice" title={t("appearance.undo")} aria-label={t("appearance.undo")} onClick={appearance.undo} disabled={appearance.record.revisions.length < 2}>
            {t("appearance.undo")}
          </button>
          <button type="button" className="appearance-choice" title={t("appearance.reset")} aria-label={t("appearance.reset")} onClick={appearance.reset}>
            {t("appearance.reset")}
          </button>
        </div>
        {appearance.persistenceError ? <p role="alert">{t("appearance.saveFailed")}</p> : <p className="appearance-hint">{t("appearance.saved")}</p>}
        <h2>{t("appearance.history")}</h2>
        <ol className="appearance-history">
          {[...appearance.record.revisions].reverse().slice(0, 6).map((revision) => (
            <li key={revision.id}>
              <span>{t(revisionKeys[revision.source])}</span>
              {mounted ? (
                <time dateTime={revision.at}>
                  {new Date(revision.at).toLocaleString(locale === "ar" ? "ar" : "en")}
                </time>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ChoiceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="appearance-field">
      <span>{label}</span>
      <div className="appearance-actions" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function BackgroundButton({
  label,
  pressed,
  image,
  onClick,
}: {
  label: string;
  pressed: boolean;
  image?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="appearance-background" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <span className="appearance-thumb" style={image ? { backgroundImage: image } : undefined} />
      <span>{label}</span>
    </button>
  );
}

function gradientLabel(id: keyof typeof GRADIENT_CSS): MessageKey {
  if (id === "dusk") return "appearance.backgroundDusk";
  if (id === "harbor") return "appearance.backgroundHarbor";
  if (id === "paper") return "appearance.backgroundPaper";
  return "appearance.backgroundNight";
}

function curatedLabel(id: keyof typeof CURATED_DATA_URI): MessageKey {
  if (id === "linen") return "appearance.backgroundLinen";
  if (id === "cedar") return "appearance.backgroundCedar";
  if (id === "tide") return "appearance.backgroundTide";
  return "appearance.backgroundInk";
}
