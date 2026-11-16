import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkUrlReputation,
  normalizeReputationUrl,
} from "../src/url-reputation.js";
import { urlSafetyCheckSchema } from "../src/schemas.js";

describe("URL reputation checks", () => {
  it("bounds batched URL checks and total request size", () => {
    assert.equal(urlSafetyCheckSchema.safeParse({ urls: ["https://example.com"] }).success, true);
    assert.equal(urlSafetyCheckSchema.safeParse({ urls: [] }).success, false);
    assert.equal(
      urlSafetyCheckSchema.safeParse({
        urls: Array.from({ length: 501 }, () => "https://example.com"),
      }).success,
      false,
    );
    assert.equal(
      urlSafetyCheckSchema.safeParse({
        urls: Array.from({ length: 100 }, () => `https://example.com/${"x".repeat(1500)}`),
      }).success,
      false,
    );
  });

  it("normalizes public HTTP(S) URLs and rejects credentials or unsafe schemes", () => {
    assert.deepEqual(normalizeReputationUrl("https://example.com/path#fragment"), {
      value: "https://example.com/path",
      isPublic: true,
    });
    assert.equal(normalizeReputationUrl("javascript:alert(1)"), null);
    assert.equal(normalizeReputationUrl("https://user@example.com"), null);
  });

  it("does not submit local hosts or IP literals to the reputation provider", async () => {
    let requested = false;
    const results = await checkUrlReputation(
      ["http://localhost/private", "http://192.168.1.1/admin"],
      {
        apiKey: "test-key",
        fetcher: async () => {
          requested = true;
          throw new Error("unexpected provider request");
        },
      },
    );
    assert.equal(requested, false);
    assert.deepEqual(results.map((result) => result.status), [
      "unverifiable",
      "unverifiable",
    ]);
  });

  it("reports clean and threat URLs independently", async () => {
    const results = await checkUrlReputation(
      ["https://url-check-clean.example.org/", "https://url-check-threat.example.org/"],
      {
        apiKey: "test-key",
        fetcher: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as {
            threatInfo: { threatEntries: Array<{ url: string }> };
          };
          return new Response(JSON.stringify({
            threatMatches: [{
              threatType: "SOCIAL_ENGINEERING",
              threat: { url: body.threatInfo.threatEntries[1].url },
            }],
          }), { status: 200 });
        },
      },
    );
    assert.deepEqual(results.map((result) => result.status), ["clean", "threat"]);
    assert.deepEqual(results[1].threatTypes, ["SOCIAL_ENGINEERING"]);
  });

  it("fails closed when the provider is missing, unavailable, or malformed", async () => {
    const url = "https://url-check-unavailable.example.org/";
    const withoutKey = await checkUrlReputation([url]);
    assert.equal(withoutKey[0].status, "unavailable");

    await assert.rejects(
      checkUrlReputation(["https://url-check-provider-error.example.org/"], {
        apiKey: "test-key",
        fetcher: async () => new Response(null, { status: 503 }),
      }),
      /could not complete the check/,
    );
    await assert.rejects(
      checkUrlReputation(["https://url-check-malformed.example.org/"], {
        apiKey: "test-key",
        fetcher: async () => new Response(JSON.stringify({ threatMatches: "bad" })),
      }),
      /invalid response/,
    );
  });
});
