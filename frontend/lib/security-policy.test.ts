import { describe, expect, it } from "vitest";
import { createContentSecurityPolicy } from "./security-policy";

describe("createContentSecurityPolicy", () => {
  it("uses a nonce and does not allow inline scripts", () => {
    const policy = createContentSecurityPolicy("test-nonce", {
      development: false,
      apiUrl: "https://api.example.test/v1",
    });

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("https://api.example.test");
    expect(policy).toContain("wss://api.example.test");
  });

  it("allows only the development eval and reload requirements", () => {
    const policy = createContentSecurityPolicy("dev-nonce", {
      development: true,
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws://localhost:3000");
    expect(policy).toContain("https://accounts.google.com");
    expect(policy).toContain("https://www.googleapis.com");
    expect(policy).toContain("https://*.backblazeb2.com");
    expect(policy).toContain(
      "frame-src https://accounts.google.com https://www.youtube-nocookie.com",
    );
  });

  it("rejects malformed API origins rather than widening the policy", () => {
    expect(() =>
      createContentSecurityPolicy("nonce", {
        development: false,
        apiUrl: "not a URL",
      }),
    ).toThrow();
  });
});
