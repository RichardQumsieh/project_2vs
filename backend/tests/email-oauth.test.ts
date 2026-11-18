import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailProviders } from "../src/integrations/email-providers.js";
import {
  normalizeGmailMessages,
  normalizeOutlookMailMessages,
} from "../src/integrations/email-sync.js";

describe("email OAuth helpers", () => {
  it("requests compose plus send scopes for approved mail", () => {
    assert.deepEqual(emailProviders.gmail.scopes, [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    assert.ok(emailProviders["outlook-mail"].scopes.includes("Mail.ReadWrite"));
    assert.ok(emailProviders["outlook-mail"].scopes.includes("Mail.Send"));
  });

  it("normalizes metadata without full bodies", () => {
    const gmail = normalizeGmailMessages({
      messages: [
        {
          id: "m1",
          threadId: "t1",
          snippet: "Thanks for sending the deck",
          internalDate: "1731672000000",
          payload: {
            headers: [
              { name: "Subject", value: "Deck" },
              { name: "From", value: "ada@example.com" },
            ],
            body: { data: "should-not-appear" },
          },
        },
      ],
    });
    assert.equal(gmail[0]?.subject, "Deck");
    assert.equal(gmail[0]?.fromAddress, "ada@example.com");
    assert.equal(
      Object.prototype.hasOwnProperty.call(gmail[0], "body"),
      false,
    );

    const outlook = normalizeOutlookMailMessages({
      value: [
        {
          id: "m2",
          conversationId: "c2",
          subject: "Follow up",
          bodyPreview: "Can we meet Thursday?",
          body: { content: "full body ignored" },
          from: { emailAddress: { address: "bob@example.com" } },
          receivedDateTime: "2026-11-15T12:00:00Z",
        },
      ],
    });
    assert.equal(outlook[0]?.snippet, "Can we meet Thursday?");
    assert.equal(
      Object.prototype.hasOwnProperty.call(outlook[0], "body"),
      false,
    );
  });
});
