import { describe, expect, it } from "vitest";
import { dominantScript } from "./script";
import { directionForLocale, translate } from "./locale";
import { ar, en } from "./messages";

describe("locale catalog", () => {
  it("covers every English key in Arabic", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it("translates the primary flows into Arabic", () => {
    expect(translate("ar", "auth.createTitle")).toMatch(/\p{Script=Arabic}/u);
    expect(translate("ar", "inbox.title")).not.toBe(en["inbox.title"]);
    expect(translate("ar", "approval.required")).not.toBe(en["approval.required"]);
    expect(translate("ar", "settings.title")).toBe("الإعدادات");
    expect(translate("ar", "group.leave")).toMatch(/\p{Script=Arabic}/u);
    expect(translate("ar", "group.memberCount", { count: 3 })).toBe("3 أعضاء");
    expect(translate("en", "auth.stepOf", { step: 2, total: 4 })).toBe("Step 2 of 4");
    expect(translate("en", "appearance.proposalEvening")).toBe("Want a calmer evening theme?");
    expect(translate("ar", "appearance.proposalEvening")).toMatch(/\p{Script=Arabic}/u);
    expect(translate("ar", "appearance.title")).toMatch(/\p{Script=Arabic}/u);
    expect(translate("ar", "inbox.hub.nav")).toMatch(/\p{Script=Arabic}/u);
    expect(translate("ar", "inbox.hub.activity")).not.toBe(en["inbox.hub.activity"]);
    expect(translate("ar", "inbox.hub.mail")).toMatch(/\p{Script=Arabic}/u);
    expect(translate("en", "inbox.hub.activity")).toBe("Activity");
  });

  it("maps locale to document direction and detects mixed script", () => {
    expect(directionForLocale("ar")).toBe("rtl");
    expect(directionForLocale("en")).toBe("ltr");
    expect(dominantScript("تمام, send the deck قبل الاجتماع")).toBe("mixed");
    expect(dominantScript("شو الأولوية؟")).toBe("arabic");
    expect(dominantScript("Board deck")).toBe("latin");
  });
});
