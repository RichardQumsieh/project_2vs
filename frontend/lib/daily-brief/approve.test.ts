import { describe, expect, it } from "vitest";
import { approveBriefAction } from "./approve";
import { sampleDailyBrief } from "./sample";
import { briefCopy, briefCopyKeys } from "./copy";

describe("daily brief approval path", () => {
  it("routes each suggestion through the existing approve client and never sends mail", async () => {
    const brief = sampleDailyBrief("en");
    const calls: string[] = [];
    const clients = {
      createEmailDraft: async () => {
        calls.push("draft");
      },
      updateCalendarEvent: async () => {
        calls.push("reschedule");
      },
      deleteCalendarEvent: async () => {
        calls.push("decline");
      },
    };
    await approveBriefAction(brief.actions[0]!, clients);
    await approveBriefAction(brief.actions[1]!, clients);
    await approveBriefAction(brief.actions[2]!, clients);
    expect(calls).toEqual(["draft", "reschedule", "decline"]);
  });
});

describe("daily brief copy", () => {
  it("has an Arabic line for every English label", () => {
    for (const key of briefCopyKeys) {
      const arabic = briefCopy("ar", key, { time: "07:00", title: "البورد", count: 3 });
      const english = briefCopy("en", key, { time: "07:00", title: "Board", count: 3 });
      expect(arabic.length).toBeGreaterThan(0);
      if (key !== "english" && key !== "arabic") expect(arabic).not.toBe(english);
    }
    expect(briefCopy("ar", "title")).toMatch(/\p{Script=Arabic}/u);
    expect(briefCopy("ar", "waiting", { time: "07:00" })).toContain("07:00");
  });
});
