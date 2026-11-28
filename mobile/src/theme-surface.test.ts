import { describe, expect, it } from "vitest";
import { notificationCopy, stageQuickReply, takeQuickReply } from "../../frontend/lib/notifications/presentation";
import { parseGeneratedTheme } from "../../frontend/lib/themes/tokens";
import { wallpaperIsSafe, wallpaperSvg } from "../../frontend/lib/themes/wallpaper";
import { parseCallAction, rememberSender, shouldUseFullScreenCall } from "./call-alert";
import { bubbleColors, screenColors } from "./theme-surface";

const theme = parseGeneratedTheme({
  name: "Night",
  emoji: "🌙",
  fontWeight: "semibold",
  cornerRadius: 20,
  iconAccent: "#d6c4ff",
  light: {
    primary: "#3d2a6d", secondary: "#245c4a", accent: "#3d2a6d", background: "#f7f4ef", surface: "#ffffff",
    bubbleMine: "#3d2a6d", bubbleTheirs: "#ffffff", text: "#241c33", textMuted: "#5c5670", textOnMine: "#ffffff", textOnTheirs: "#241c33",
  },
  dark: {
    primary: "#d6c4ff", secondary: "#b7e0c8", accent: "#d6c4ff", background: "#120e18", surface: "#1c1724",
    bubbleMine: "#6d55a5", bubbleTheirs: "#241c33", text: "#f7f4ef", textMuted: "#d9d3e4", textOnMine: "#ffffff", textOnTheirs: "#f7f4ef",
  },
  wallpaper: { motif: "rings", angle: 12, colors: ["#6d55a5", "#120e18"] },
});

describe("mobile theme and alerts", () => {
  it("applies bubble colors from the generated theme", () => {
    expect(theme).not.toBeNull();
    expect(bubbleColors(theme, "dark", true)).toMatchObject({ backgroundColor: "#6d55a5", color: "#ffffff", borderRadius: 20 });
    expect(screenColors(theme, "dark")?.backgroundColor).toBe("#120e18");
    expect(wallpaperIsSafe(wallpaperSvg(theme!.wallpaper))).toBe(true);
  });

  it("uses a full-screen call only outside the active app and keeps replies local", () => {
    expect(shouldUseFullScreenCall("background")).toBe(true);
    expect(shouldUseFullScreenCall("active")).toBe(false);
    expect(parseCallAction({ action: "accept", callId: "c", conversationId: "chat" })?.action).toBe("accept");
    expect(parseCallAction({ action: "nope" })).toBeNull();
    const directory = rememberSender({}, "ada", "Ada");
    expect(notificationCopy({ hidePreviews: false, senderName: directory.ada, decryptedPreview: null, conversationOpen: false }).title).toBe("Ada");
    const reply = stageQuickReply(null, "chat", "see you");
    expect(takeQuickReply(reply, "chat").text).toBe("see you");
  });
});
