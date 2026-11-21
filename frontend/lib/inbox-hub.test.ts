import { describe, expect, it } from "vitest";
import {
  LEGACY_ACTIVITY_PATH,
  firstQueryValue,
  inboxHubHref,
  legacyActivityRedirect,
  parseInboxHub,
  parseInboxMailView,
} from "./inbox-hub";

describe("inbox hub", () => {
  it("keeps chats as the default section", () => {
    expect(parseInboxHub(null)).toBe("chats");
    expect(parseInboxHub(undefined)).toBe("chats");
    expect(parseInboxHub("")).toBe("chats");
    expect(parseInboxHub("groups")).toBe("chats");
    expect(parseInboxHub("settings")).toBe("chats");
  });

  it("accepts only the sections the inbox renders", () => {
    expect(parseInboxHub("activity")).toBe("activity");
    expect(parseInboxHub("mail")).toBe("mail");
    expect(parseInboxHub("assistant")).toBe("assistant");
    expect(parseInboxHub("chats")).toBe("chats");
  });

  it("builds stable hrefs for bookmarks", () => {
    expect(inboxHubHref("chats")).toBe("/inbox");
    expect(inboxHubHref("assistant")).toBe("/inbox?hub=assistant");
    expect(inboxHubHref("activity")).toBe("/inbox?hub=activity");
    expect(inboxHubHref("mail")).toBe("/inbox?hub=mail");
    expect(inboxHubHref("mail", "agenda")).toBe("/inbox?hub=mail");
    expect(inboxHubHref("mail", "email")).toBe("/inbox?hub=mail&view=email");
    expect(inboxHubHref("mail", "event")).toBe("/inbox?hub=mail&view=event");
    expect(inboxHubHref("chats", "email")).toBe("/inbox");
  });

  it("reads the first query value", () => {
    expect(firstQueryValue(undefined)).toBeNull();
    expect(firstQueryValue("mail")).toBe("mail");
    expect(firstQueryValue(["activity", "mail"])).toBe("activity");
    expect(firstQueryValue([])).toBeNull();
  });

  it("ignores unknown mail views", () => {
    expect(parseInboxMailView(null)).toBe("agenda");
    expect(parseInboxMailView("compose")).toBe("agenda");
    expect(parseInboxMailView("email")).toBe("email");
    expect(parseInboxMailView("event")).toBe("event");
  });

  it("sends the old activity route to the inbox activity section", () => {
    expect(LEGACY_ACTIVITY_PATH).toBe("/settings/activity");
    expect(legacyActivityRedirect()).toBe("/inbox?hub=activity");
    expect(legacyActivityRedirect()).toBe(inboxHubHref("activity"));
  });
});
