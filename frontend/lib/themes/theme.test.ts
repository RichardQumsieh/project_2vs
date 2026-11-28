import { describe, expect, it } from "vitest";
import { contrastRatio } from "../appearance/contrast";
import { incomingCallDecision } from "../calls/incoming-alert";
import { notificationCopy, stageQuickReply, takeQuickReply } from "../notifications/presentation";
import { parseGeneratedTheme, themeCssVariables } from "./tokens";
import { wallpaperDataUri, wallpaperIsSafe, wallpaperSvg } from "./wallpaper";

const theme = parseGeneratedTheme({
  name: "Harbor",
  emoji: "🌊",
  fontWeight: "medium",
  cornerRadius: 18,
  iconAccent: "#1d4e89",
  light: {
    primary: "#1d4e89",
    secondary: "#0f6e6e",
    accent: "#1d4e89",
    background: "#f4f7fb",
    surface: "#ffffff",
    bubbleMine: "#1d4e89",
    bubbleTheirs: "#ffffff",
    text: "#142033",
    textMuted: "#3d4d63",
    textOnMine: "#ffffff",
    textOnTheirs: "#142033",
  },
  dark: {
    primary: "#9ec1ff",
    secondary: "#8fd0c8",
    accent: "#9ec1ff",
    background: "#0c121c",
    surface: "#151c28",
    bubbleMine: "#2a4f86",
    bubbleTheirs: "#1a2433",
    text: "#f4f7fb",
    textMuted: "#c5d0e0",
    textOnMine: "#f4f7fb",
    textOnTheirs: "#f4f7fb",
  },
  wallpaper: { motif: "waves", angle: 24, colors: ["#1d4e89", "#0f6e6e", "#f4f7fb"] },
});

describe("generated themes", () => {
  it("turns a valid theme into CSS variables and a safe wallpaper", () => {
    expect(theme).not.toBeNull();
    if (!theme) return;
    const css = themeCssVariables(theme, "light");
    expect(css["--bubble-mine"]).toBe("#1d4e89");
    expect(css["--theme-radius"]).toBe("18px");
    expect(contrastRatio(css["--bubble-mine-text"]!, css["--bubble-mine"]!)).toBeGreaterThanOrEqual(4.5);
    const svg = wallpaperSvg(theme.wallpaper);
    expect(wallpaperIsSafe(svg)).toBe(true);
    expect(wallpaperDataUri(theme.wallpaper).startsWith("data:image/svg+xml,")).toBe(true);
    expect(svg).not.toContain("Spider");
  });

  it("rejects a theme that tries to carry a link", () => {
    expect(parseGeneratedTheme({
      name: "https://evil.example",
      emoji: "✨",
      fontWeight: "regular",
      cornerRadius: 12,
      iconAccent: "#000000",
      light: theme?.light,
      dark: theme?.dark,
      wallpaper: { motif: "gradient", angle: 0, colors: ["#000000", "javascript:alert(1)"] },
    })).toBeNull();
  });
});

describe("notification and call presentation", () => {
  it("hides message text unless a local preview is allowed", () => {
    expect(notificationCopy({ hidePreviews: true, senderName: "Ada", decryptedPreview: "secret plan", conversationOpen: false }).body).toBe("New message");
    expect(notificationCopy({ hidePreviews: false, senderName: "Ada", decryptedPreview: "secret plan", conversationOpen: false })).toEqual({
      show: true,
      title: "Ada",
      body: "secret plan",
    });
    expect(notificationCopy({ hidePreviews: false, senderName: "Ada", conversationOpen: true }).show).toBe(false);
  });

  it("keeps a quick reply on the device until the open chat consumes it", () => {
    const staged = stageQuickReply(null, "chat-1", "  on my way  ");
    expect(takeQuickReply(staged, "chat-2").text).toBeNull();
    expect(takeQuickReply(staged, "chat-1")).toEqual({ next: null, text: "on my way" });
  });

  it("shows a browser call notification only while the page is hidden", () => {
    expect(incomingCallDecision({
      direction: "incoming",
      phase: "ringing",
      documentHidden: false,
      permission: "granted",
    }).notify).toBe(false);
    expect(incomingCallDecision({
      direction: "incoming",
      phase: "ringing",
      documentHidden: true,
      permission: "granted",
    })).toMatchObject({ notify: true, title: "Incoming call", body: "Incoming call" });
  });
});
