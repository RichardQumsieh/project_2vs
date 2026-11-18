import { describe, expect, it } from "vitest";
import {
  approveVerb,
  filterSlashHints,
  outboundPayloadFields,
  provenanceLabel,
  providerBadgeForAction,
} from "./sophia-proposal-ux";

describe("sophia-proposal-ux", () => {
  it("labels provenance for briefing and radar sources", () => {
    expect(provenanceLabel("briefing")).toBe("From briefing");
    expect(provenanceLabel("radar")).toBe("From radar");
    expect(provenanceLabel("deadline")).toBe("From deadline scan");
    expect(provenanceLabel(undefined)).toBeNull();
  });

  it("maps job tools to provider badges", () => {
    expect(
      providerBadgeForAction({
        type: "draft_email",
        provider: "gmail",
        to: ["a@example.com"],
        subject: "Hi",
        body: "Body",
      }).label,
    ).toBe("Gmail");
    expect(
      providerBadgeForAction({
        type: "create_github_issue",
        owner: "acme",
        repo: "ops",
        title: "Issue",
      }).id,
    ).toBe("github");
    expect(
      providerBadgeForAction({
        type: "post_slack_message",
        channelId: "C1",
        text: "hi",
      }).label,
    ).toBe("Slack");
  });

  it("exposes exact outbound payload fields for approval review", () => {
    const fields = outboundPayloadFields({
      type: "create_calendar_event",
      provider: "google",
      title: "Sync",
      startsAt: "2026-11-20T16:00:00.000Z",
      endsAt: "2026-11-20T16:30:00.000Z",
      description: "Hold",
    });
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: "Provider", value: "google" },
        { label: "Title", value: "Sync" },
        { label: "Starts", value: "2026-11-20T16:00:00.000Z" },
        { label: "Ends", value: "2026-11-20T16:30:00.000Z" },
        { label: "Description", value: "Hold" },
      ]),
    );
  });

  it("filters slash hints from a leading slash token", () => {
    expect(filterSlashHints("/sl").map((hint) => hint.id)).toEqual(["slack"]);
    expect(filterSlashHints("hello")).toEqual([]);
    expect(filterSlashHints("/").length).toBeGreaterThan(3);
  });

  it("keeps approve verbs explicit (no silent-send wording)", () => {
    expect(
      approveVerb({
        type: "post_slack_message",
        channelId: "C1",
        text: "hi",
      }),
    ).toBe("Approve post");
    expect(
      approveVerb({
        type: "draft_email",
        provider: "gmail",
        to: ["a@example.com"],
        subject: "Hi",
        body: "Body",
      }),
    ).toBe("Approve draft");
    expect(
      approveVerb({
        type: "draft_email",
        provider: "gmail",
        to: ["a@example.com"],
        subject: "Hi",
        body: "Body",
        delivery: "send",
        contentType: "text/html",
        html: "<strong>Body</strong>",
      }),
    ).toBe("Approve send");
    expect(
      outboundPayloadFields({
        type: "draft_email",
        provider: "gmail",
        to: ["a@example.com"],
        subject: "Hi",
        body: "Body",
        delivery: "send",
        contentType: "text/html",
        html: "<strong>Body</strong>",
      }),
    ).toEqual(
      expect.arrayContaining([
        { label: "Delivery", value: "send" },
        { label: "HTML body", value: "<strong>Body</strong>" },
      ]),
    );
    const withFile = outboundPayloadFields({
      type: "draft_email",
      provider: "gmail",
      to: ["a@example.com"],
      subject: "Hi",
      body: "Body",
      delivery: "send",
      attachments: [
        {
          filename: "notes.pdf",
          contentType: "application/pdf",
          size: 2048,
          contentBase64: "QUJDRA==",
        },
      ],
    });
    expect(withFile).toEqual(
      expect.arrayContaining([
        {
          label: "Attachments",
          value: "notes.pdf · application/pdf · 2.0 KB",
        },
      ]),
    );
    expect(withFile.some((field) => field.value.includes("QUJDRA=="))).toBe(false);
  });
});
