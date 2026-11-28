import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { api, type SessionUser } from "./api";
import { saveAvatarPrefs, useAvatarPrefs } from "./avatar-prefs";
import { AvatarStage } from "./avatar-stage";
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
  type GreetingAnimation,
} from "../../frontend/lib/avatar/config";
import { prefersStaticAvatars } from "../../frontend/lib/avatar/greeting";
import { ActionButton, C, Notice } from "./ui";

const CHOICES: Array<{ key: keyof AvatarConfig; label: string; options: readonly string[] }> = [
  { key: "body", label: "Body", options: BODY_SHAPES },
  { key: "head", label: "Head", options: HEAD_SHAPES },
  { key: "hair", label: "Hair", options: HAIR_STYLES },
  { key: "eyes", label: "Eyes", options: EYE_SHAPES },
  { key: "brows", label: "Eyebrows", options: BROW_STYLES },
  { key: "mouth", label: "Mouth", options: MOUTH_STYLES },
  { key: "facialHair", label: "Facial hair", options: FACIAL_HAIR },
  { key: "glasses", label: "Glasses", options: GLASSES },
  { key: "accessory", label: "Accessory", options: ACCESSORIES },
  { key: "outfit", label: "Outfit", options: OUTFITS },
];

function Chips({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: value === option }} onPress={() => onChange(option)} style={[styles.chip, value === option && styles.chipOn]}>
          <Text style={[styles.chipText, value === option && styles.chipTextOn]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Swatches({ value, colors, onChange }: { value: string; colors: string[]; onChange: (color: string) => void }) {
  return (
    <View style={styles.chips}>
      {colors.map((color) => (
        <Pressable key={color} accessibilityRole="button" accessibilityLabel={color} onPress={() => onChange(color)} style={[styles.swatch, { backgroundColor: color }, value === color && styles.swatchOn]} />
      ))}
    </View>
  );
}

export function AvatarCreator({
  cookie,
  profile,
  onSaved,
  onClose,
}: {
  cookie: string;
  profile: SessionUser;
  onSaved: (user: SessionUser) => void;
  onClose: () => void;
}) {
  const prefs = useAvatarPrefs();
  const initial = parseAvatarConfig(profile.avatarConfig) ?? defaultAvatar();
  const [draft, setDraft] = useState(() => createDraft(initial));
  const [greeting, setGreeting] = useState(parseGreetingText(profile.greetingText) ?? "");
  const [animation, setAnimation] = useState<GreetingAnimation>(parseGreetingAnimation(profile.greetingAnimation) ?? "wave");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const staticAvatars = prefersStaticAvatars(prefs, false);

  async function save(clear = false) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const response = await api.updateAvatar(cookie, clear ? {
        avatarConfig: null,
        greetingText: null,
        greetingAnimation: null,
      } : {
        avatarConfig: draft.current,
        greetingText: greeting.trim() || null,
        greetingAnimation: animation,
      });
      onSaved({ ...profile, ...response.user });
      if (clear) {
        setGreeting("");
        setDraft(createDraft(defaultAvatar()));
      }
      setSaved(clear ? "Removed the 3D avatar. Your photo or initials still show." : "Saved on your profile.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the avatar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Your avatar</Text>
      <Text style={styles.copy}>The portrait is generated on this phone. It is profile data, like your name. Messages stay end-to-end encrypted.</Text>
      <View style={styles.preview}>
        <AvatarStage
          person={{ ...profile, avatarConfig: draft.current }}
          size={220}
          animation={preview ? animation : "idle"}
          playing={!staticAvatars}
        />
      </View>
      {greeting.trim() && preview ? <Text style={styles.bubble}>{greeting.trim()}</Text> : null}
      <View style={styles.row}>
        <ActionButton title="Randomize" onPress={() => { setSaved(""); setDraft((current) => replaceDraft(current, randomAvatar())); }} secondary />
        <ActionButton title="Undo" onPress={() => setDraft((current) => undoDraft(current))} disabled={draft.past.length === 0} secondary />
      </View>
      {CHOICES.map((choice) => (
        <View key={choice.key}>
          <Text style={styles.label}>{choice.label}</Text>
          <Chips value={String(draft.current[choice.key])} options={choice.options} onChange={(option) => {
            setSaved("");
            setDraft((current) => replaceDraft(current, { ...current.current, [choice.key]: option }));
          }} />
        </View>
      ))}
      <Text style={styles.label}>Skin tone</Text>
      <Swatches value={draft.current.skin} colors={SKIN_SWATCHES} onChange={(skin) => setDraft((current) => replaceDraft(current, { ...current.current, skin }))} />
      <Text style={styles.label}>Hair color</Text>
      <Swatches value={draft.current.hairColor} colors={HAIR_SWATCHES} onChange={(hairColor) => setDraft((current) => replaceDraft(current, { ...current.current, hairColor }))} />
      <Text style={styles.label}>Eye color</Text>
      <Swatches value={draft.current.eyeColor} colors={EYE_SWATCHES} onChange={(eyeColor) => setDraft((current) => replaceDraft(current, { ...current.current, eyeColor }))} />
      <Text style={styles.label}>Outfit color</Text>
      <Swatches value={draft.current.top} colors={CLOTH_SWATCHES} onChange={(top) => setDraft((current) => replaceDraft(current, { ...current.current, top }))} />
      <Text style={styles.label}>Accent</Text>
      <Swatches value={draft.current.accent} colors={CLOTH_SWATCHES} onChange={(accent) => setDraft((current) => replaceDraft(current, { ...current.current, accent }))} />
      <Text style={styles.label}>Greeting</Text>
      <TextInput
        value={greeting}
        maxLength={GREETING_TEXT_MAX}
        onChangeText={(value) => { setSaved(""); setGreeting(value.slice(0, GREETING_TEXT_MAX)); }}
        placeholder="hey there.."
        placeholderTextColor={C.faint}
        style={styles.input}
      />
      <Text style={styles.hint}>Shown once when someone opens a chat or your profile. {greeting.trim().length}/{GREETING_TEXT_MAX}</Text>
      <Text style={styles.label}>Animation</Text>
      <Chips value={animation} options={GREETING_ANIMATIONS} onChange={(value) => { setAnimation(value as GreetingAnimation); setPreview(true); }} />
      <View style={styles.toggle}>
        <Text style={styles.toggleText}>Reduce motion / static avatars</Text>
        <Switch
          value={prefs.staticAvatars}
          onValueChange={(staticAvatars) => { void saveAvatarPrefs({ ...prefs, staticAvatars }); }}
        />
      </View>
      <View style={styles.toggle}>
        <Text style={styles.toggleText}>Speak greetings</Text>
        <Switch
          value={prefs.speakGreetings}
          onValueChange={(speakGreetings) => { void saveAvatarPrefs({ ...prefs, speakGreetings }); }}
        />
      </View>
      <Text style={styles.hint}>Speech is off until you turn it on. This phone reads the greeting; it is not sent anywhere.</Text>
      {error ? <Notice text={error} /> : null}
      {saved ? <Notice text={saved} tone="success" /> : null}
      <ActionButton title="Preview greeting" onPress={() => setPreview(true)} secondary />
      <ActionButton title="Save avatar" onPress={() => void save(false)} busy={busy} />
      <ActionButton title="Remove 3D avatar" onPress={() => void save(true)} busy={busy} secondary />
      <ActionButton title="Close" onPress={onClose} secondary />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12, paddingBottom: 48 },
  title: { color: C.ink, fontFamily: "Georgia", fontSize: 28 },
  copy: { color: C.muted, fontSize: 13, lineHeight: 19 },
  preview: { alignItems: "center", paddingVertical: 8 },
  bubble: { alignSelf: "center", backgroundColor: C.ink, color: "white", borderRadius: 16, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 8 },
  label: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, justifyContent: "center" },
  chipOn: { backgroundColor: C.purple, borderColor: C.purple },
  chipText: { color: C.ink, fontSize: 13 },
  chipTextOn: { color: "white", fontWeight: "700" },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: "#00000022" },
  swatchOn: { borderColor: C.ink, borderWidth: 2 },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, color: C.ink, backgroundColor: "white" },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  toggleText: { color: C.ink, fontSize: 14, flex: 1 },
});
