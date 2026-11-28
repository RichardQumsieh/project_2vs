import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEXT_CONTRAST, contrastRatio } from "../src/contrast.js";
import { screenThemeText } from "../src/theme-content.js";
import { backgroundLuminance, generateThemeForUser, mockTheme, themeSystemPrompt } from "../src/theme-generate.js";
import { acceptTheme, paletteMeetsContrast, type GeneratedTheme } from "../src/theme-tokens.js";

const whiteOnWhite: GeneratedTheme = {
  name: "Blank",
  emoji: "✨",
  fontWeight: "medium",
  cornerRadius: 16,
  iconAccent: "#ffffff",
  light: {
    primary: "#ffffff",
    secondary: "#f4f4f4",
    accent: "#ffffff",
    background: "#ffffff",
    surface: "#ffffff",
    bubbleMine: "#ffffff",
    bubbleTheirs: "#f7f7f7",
    text: "#ffffff",
    textMuted: "#fafafa",
    textOnMine: "#ffffff",
    textOnTheirs: "#ffffff",
  },
  dark: {
    primary: "#000000",
    secondary: "#111111",
    accent: "#000000",
    background: "#000000",
    surface: "#000000",
    bubbleMine: "#000000",
    bubbleTheirs: "#050505",
    text: "#000000",
    textMuted: "#111111",
    textOnMine: "#000000",
    textOnTheirs: "#000000",
  },
  wallpaper: { motif: "dots", angle: 0, colors: ["#ffffff", "#000000"] },
};

describe("theme generation", () => {
  it("rewrites colors that miss WCAG AA", () => {
    const accepted = acceptTheme(whiteOnWhite);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.ok(accepted.adjustments.length > 0);
    assert.equal(paletteMeetsContrast(accepted.theme.light), true);
    assert.equal(paletteMeetsContrast(accepted.theme.dark), true);
    assert.ok(contrastRatio(accepted.theme.light.text, accepted.theme.light.background) >= TEXT_CONTRAST);
    assert.ok(contrastRatio(accepted.theme.light.textOnMine, accepted.theme.light.bubbleMine) >= TEXT_CONTRAST);
  });

  it("rejects markup and remote images", () => {
    const blocked = screenThemeText("put https://example.com/logo.png on the wallpaper", 180);
    assert.equal(blocked.ok, false);
    const markup = acceptTheme({ ...whiteOnWhite, name: "<script>" });
    assert.equal(markup.ok, false);
  });

  it("blocks a disallowed prompt before any model call", async () => {
    let called = false;
    const result = await generateThemeForUser({
      userId: "user-a",
      prompt: "csam theme",
      now: 1_000,
      buckets: new Map(),
      config: {
        apiKey: "test-key",
        baseUrl: "https://model.test/v1",
        fetchImpl: (async () => {
          called = true;
          throw new Error("must not be called");
        }) as typeof fetch,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(called, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it("uses the configured model and keeps the prompt out of a failure object", async () => {
    const prompt = "Spider-Man, Tom Holland";
    let body = "";
    const result = await generateThemeForUser({
      userId: "user-a",
      prompt,
      tweak: "darker",
      now: 1_000,
      buckets: new Map(),
      config: {
        apiKey: "test-key",
        baseUrl: "https://api.x.ai/v1",
        model: "grok-4",
        fetchImpl: (async (_url, init) => {
          body = String(init?.body ?? "");
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(whiteOnWhite) } }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch,
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source, "model");
    assert.equal(paletteMeetsContrast(result.theme.light), true);
    assert.match(body, /grok-4/);
    assert.match(body, /json_schema/);
    assert.match(body, /Spider-Man/);
    assert.equal(themeSystemPrompt().includes("logos"), true);
    assert.equal(JSON.stringify(result).includes("test-key"), false);
  });

  it("mocks a deterministic theme and darkens it when asked", async () => {
    const first = await generateThemeForUser({
      userId: "user-a",
      prompt: "harbor at dusk",
      now: 1_000,
      buckets: new Map(),
      config: {},
    });
    const darker = mockTheme("harbor at dusk", "darker");
    const base = mockTheme("harbor at dusk");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.source, "mock");
    assert.equal(paletteMeetsContrast(first.theme.light), true);
    assert.ok(backgroundLuminance(darker, "dark") <= backgroundLuminance(base, "dark"));
    assert.equal(JSON.stringify(first.theme).includes("http"), false);
  });

  it("rate limits generation per user", async () => {
    const buckets = new Map();
    const config = {};
    for (let index = 0; index < 8; index += 1) {
      const result = await generateThemeForUser({
        userId: "user-a",
        prompt: "calm paper",
        now: 5_000,
        buckets,
        config,
      });
      assert.equal(result.ok, true);
    }
    const limited = await generateThemeForUser({
      userId: "user-a",
      prompt: "calm paper",
      now: 5_000,
      buckets,
      config,
    });
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.equal(limited.status, 429);
    const other = await generateThemeForUser({
      userId: "user-b",
      prompt: "calm paper",
      now: 5_000,
      buckets,
      config,
    });
    assert.equal(other.ok, true);
  });
});
