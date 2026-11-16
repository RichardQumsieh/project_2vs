import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOAuthState, parseOAuthState } from "../src/integrations/oauth-state.js";
import { workProviders } from "../src/integrations/work-providers.js";
import {
  normalizeGitHubWorkItems,
  normalizeLinearWorkItems,
} from "../src/integrations/work-sync.js";

describe("work OAuth helpers", () => {
  it("uses minimum GitHub/Linear scopes without write/admin", () => {
    assert.deepEqual(workProviders.github.scopes, ["read:user", "repo"]);
    assert.deepEqual(workProviders.linear.scopes, ["read"]);
    assert.ok(
      !workProviders.github.scopes.some((scope) =>
        /admin|delete_repo|workflow/i.test(scope),
      ),
    );
    assert.ok(
      !workProviders.linear.scopes.some((scope) => /write|admin/i.test(scope)),
    );
  });

  it("round-trips signed OAuth state for github and linear", () => {
    const secret = "test-oauth-state-secret-at-least-32-chars";
    const now = new Date("2026-11-16T12:00:00.000Z");
    for (const provider of ["github", "linear"] as const) {
      const state = createOAuthState(
        {
          userId: "user-a",
          provider,
          nonce: "work-nonce",
          now,
        },
        secret,
      );
      assert.deepEqual(parseOAuthState(state, secret, now), {
        userId: "user-a",
        provider,
        nonce: "work-nonce",
        exp: now.getTime() + 10 * 60 * 1000,
      });
    }
  });

  it("normalizes metadata without keeping issue bodies", () => {
    const github = normalizeGitHubWorkItems([
      {
        id: 42,
        number: 7,
        title: "Fix sync",
        state: "open",
        html_url: "https://github.com/acme/app/issues/7",
        body: "secret description must not be required",
        updated_at: "2026-11-16T10:00:00Z",
        repository: { full_name: "acme/app" },
      },
      {
        id: 43,
        number: 8,
        title: "Ship PR",
        state: "open",
        html_url: "https://github.com/acme/app/pull/8",
        pull_request: { url: "https://api.github.com/repos/acme/app/pulls/8" },
        updated_at: "2026-11-16T11:00:00Z",
        repository: { full_name: "acme/app" },
      },
    ]);
    assert.equal(github.length, 2);
    assert.equal(github[0]?.kind, "ISSUE");
    assert.equal(github[1]?.kind, "PULL_REQUEST");
    assert.equal(github[0]?.title, "Fix sync");
    assert.equal(
      Object.prototype.hasOwnProperty.call(github[0], "body"),
      false,
    );

    const linear = normalizeLinearWorkItems({
      data: {
        issues: {
          nodes: [
            {
              id: "iss-1",
              identifier: "ENG-12",
              title: "Radar briefing",
              url: "https://linear.app/acme/issue/ENG-12",
              updatedAt: "2026-11-16T09:00:00.000Z",
              description: "should be ignored",
              state: { name: "In Progress", type: "started" },
              team: { key: "ENG" },
            },
          ],
        },
      },
    });
    assert.equal(linear[0]?.number, 12);
    assert.equal(linear[0]?.containerKey, "ENG");
    assert.equal(
      Object.prototype.hasOwnProperty.call(linear[0], "description"),
      false,
    );
  });
});
