import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLISHED_FRONTEND_ORIGIN,
  allowedFrontendOrigins,
  credentialedCorsHeaders,
  isAllowedFrontendOrigin,
} from "../src/cors-allowlist.js";

describe("API CORS allowlist", () => {
  it("always allows the published app and the configured origin", () => {
    const allowed = allowedFrontendOrigins("http://localhost:3000");
    assert.ok(allowed.includes(PUBLISHED_FRONTEND_ORIGIN));
    assert.ok(allowed.includes("http://localhost:3000"));
    assert.equal(isAllowedFrontendOrigin("https://sophia.apps.grok.bot", allowed), true);
    assert.equal(isAllowedFrontendOrigin("https://evil.example", allowed), false);
    assert.equal(isAllowedFrontendOrigin(undefined, allowed), false);
  });

  it("keeps a single origin when FRONTEND_ORIGIN is already the published app", () => {
    const allowed = allowedFrontendOrigins("https://sophia.apps.grok.bot/");
    assert.deepEqual(allowed, [PUBLISHED_FRONTEND_ORIGIN]);
  });

  it("echoes one concrete origin with credentials and never a wildcard", () => {
    const allowed = allowedFrontendOrigins("https://sophia.apps.grok.bot");
    const headers = credentialedCorsHeaders("https://sophia.apps.grok.bot", allowed);
    assert.equal(headers["Access-Control-Allow-Origin"], "https://sophia.apps.grok.bot");
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
    assert.equal(headers["Access-Control-Allow-Origin"] === "*", false);
    assert.deepEqual(credentialedCorsHeaders("https://evil.example", allowed), {});
  });
});
