import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collabProviders } from "../src/integrations/collab-providers.js";
import { normalizeSlackChannels } from "../src/integrations/collab-sync.js";
import { createOAuthState, parseOAuthState } from "../src/integrations/oauth-state.js";

describe("collab OAuth helpers", () => {
  it("uses channel-read + chat:write without history (Phase 4.2)", () => {
    assert.deepEqual(collabProviders.slack.scopes, [
      "channels:read",
      "groups:read",
      "users:read",
      "chat:write",
    ]);
    assert.ok(
      !collabProviders.slack.scopes.some((scope) =>
        /history|files:write|admin/i.test(scope),
      ),
    );
  });

  it("round-trips signed OAuth state for slack", () => {
    const secret = "test-oauth-state-secret-at-least-32-chars";
    const now = new Date("2026-11-16T12:00:00.000Z");
    const state = createOAuthState(
      {
        userId: "user-a",
        provider: "slack",
        nonce: "slack-nonce",
        now,
      },
      secret,
    );
    assert.deepEqual(parseOAuthState(state, secret, now), {
      userId: "user-a",
      provider: "slack",
      nonce: "slack-nonce",
      exp: now.getTime() + 10 * 60 * 1000,
    });
  });

  it("normalizes channel metadata and skips DMs", () => {
    const channels = normalizeSlackChannels({
      ok: true,
      channels: [
        {
          id: "C1",
          name: "general",
          is_private: false,
          is_archived: false,
          // Should not appear in mirror shape:
          purpose: { value: "team chat plaintext must not be required" },
        },
        {
          id: "D1",
          name: "direct",
          is_im: true,
        },
        {
          id: "G1",
          name: "private-eng",
          is_private: true,
          is_group: true,
          is_archived: false,
        },
      ],
    });
    assert.equal(channels.length, 2);
    assert.equal(channels[0]?.name, "general");
    assert.equal(channels[1]?.isPrivate, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(channels[0], "purpose"),
      false,
    );
  });
});
