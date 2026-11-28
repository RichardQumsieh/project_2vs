import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "./api";
import { parseGeneratedTheme, readSavedTheme, type GeneratedTheme, type SavedTheme } from "../../frontend/lib/themes/tokens";
import { useMobileTheme } from "./theme-provider";
import { ActionButton, Card, Notice } from "./ui";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function ThemeStudio({ cookie }: { cookie: string }) {
  const themes = useMobileTheme();
  const [prompt, setPrompt] = useState("Spider-Man, Tom Holland");
  const [tweak, setTweak] = useState("");
  const [draft, setDraft] = useState<GeneratedTheme | null>(null);
  const [mine, setMine] = useState<SavedTheme[]>([]);
  const [gallery, setGallery] = useState<SavedTheme[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [owned, community] = await Promise.all([api.myThemes(cookie), api.themeGallery("", cookie)]);
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
    void load().catch((cause) => setError(message(cause)));
  }, [cookie]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await api.generateTheme({ prompt, ...(tweak.trim() ? { tweak } : {}), ...(draft ? { previous: draft } : {}) }, cookie);
      const theme = parseGeneratedTheme(result.theme);
      if (!theme) throw new Error("The theme could not be previewed.");
      setDraft(theme);
      setNotice(result.adjustments.length ? "Some colors were adjusted for contrast." : "Preview ready.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.saveTheme({ prompt, theme: draft }, cookie);
      await load();
      setNotice("Saved to My Themes.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function apply(id: string) {
    try {
      await api.applyTheme({ themeId: id, scope: "app" }, cookie);
      await themes.refresh();
      setNotice("Applied across Sophia.");
    } catch (cause) {
      setError(message(cause));
    }
  }

  const preview = draft?.light;
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
    <Text style={{ fontSize: 22 }}>Themes</Text>
    <Text>Describe a look. Sophia builds colors and a pattern, not a logo or a photo.</Text>
    <TextInput value={prompt} onChangeText={setPrompt} maxLength={180} style={{ borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 72 }} />
    <TextInput value={tweak} onChangeText={setTweak} placeholder="darker" maxLength={120} style={{ borderWidth: 1, borderRadius: 12, padding: 10 }} />
    <ActionButton title={draft ? "Regenerate" : "Generate"} onPress={() => void generate()} busy={busy} />
    <ActionButton title="Save to My Themes" onPress={() => void save()} disabled={!draft} secondary />
    {preview ? <Card>
      <Text style={{ color: preview.text }}>{draft?.emoji} {draft?.name}</Text>
      <View style={{ alignSelf: "flex-start", backgroundColor: preview.bubbleTheirs, borderRadius: draft?.cornerRadius, padding: 8, marginTop: 8 }}>
        <Text style={{ color: preview.textOnTheirs }}>A message from someone else</Text>
      </View>
      <View style={{ alignSelf: "flex-end", backgroundColor: preview.bubbleMine, borderRadius: draft?.cornerRadius, padding: 8, marginTop: 8 }}>
        <Text style={{ color: preview.textOnMine }}>Your reply</Text>
      </View>
    </Card> : null}
    {!!error && <Notice text={error} />}
    {!!notice && <Notice text={notice} tone="success" />}
    <Text style={{ fontWeight: "700" }}>My Themes</Text>
    {mine.map((theme) => <Card key={theme.id}>
      <Text>{theme.emoji} {theme.name}</Text>
      <ActionButton title="Use in the app" onPress={() => void apply(theme.id)} secondary />
      <ActionButton title={theme.published ? "Unpublish" : "Publish"} onPress={() => void api.publishTheme(theme.id, !theme.published, cookie).then(load)} secondary />
    </Card>)}
    <Text style={{ fontWeight: "700" }}>Theme Gallery</Text>
    {gallery.map((theme) => <Card key={theme.id}>
      <Text>{theme.emoji} {theme.name}</Text>
      <ActionButton title="Install" onPress={() => void api.installTheme(theme.id, cookie).then(load)} secondary />
      <ActionButton title="Like" onPress={() => void api.likeTheme(theme.id, cookie)} secondary />
      <ActionButton title="Report" onPress={() => void api.reportTheme(theme.id, cookie).then(() => setNotice("Reported."))} secondary />
    </Card>)}
  </ScrollView>;
}
