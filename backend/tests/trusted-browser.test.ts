import assert from "node:assert/strict";
import test from "node:test";
import { confirmTotpSchema, loginSchema } from "../src/schemas.js";
import { networkPrefixForIp } from "../src/trusted-browser.js";

test("trusted browser network risk signal", async (t) => {
  await t.test("groups IPv4 addresses by /24", () => {
    assert.equal(networkPrefixForIp("192.0.2.17"), "v4:192.0.2");
    assert.equal(networkPrefixForIp("192.0.3.17"), "v4:192.0.3");
  });

  await t.test("groups IPv6 addresses by /64", () => {
    assert.equal(
      networkPrefixForIp("2001:db8:1234:5678::1"),
      networkPrefixForIp("2001:db8:1234:5678:abcd::1"),
    );
    assert.notEqual(
      networkPrefixForIp("2001:db8:1234:5678::1"),
      networkPrefixForIp("2001:db8:1234:5679::1"),
    );
  });

  await t.test("normalizes IPv4-mapped addresses and rejects invalid input", () => {
    assert.equal(
      networkPrefixForIp("::ffff:192.0.2.17"),
      networkPrefixForIp("192.0.2.17"),
    );
    assert.equal(networkPrefixForIp("not-an-ip"), null);
  });

  await t.test("accepts password-only checks and explicit trust choice", () => {
    assert.deepEqual(
      loginSchema.parse({
        email: "person@example.com",
        password: "correct horse battery staple",
      }),
      {
        email: "person@example.com",
        password: "correct horse battery staple",
        trustBrowser: false,
      },
    );
    assert.equal(
      loginSchema.safeParse({
        email: "person@example.com",
        password: "correct horse battery staple",
        trustBrowser: true,
      }).success,
      true,
    );
  });

  await t.test("allows explicit browser trust after authenticator enrollment", () => {
    assert.equal(
      confirmTotpSchema.safeParse({
        setupToken: "setup-token",
        code: "123456",
        trustBrowser: true,
      }).success,
      true,
    );
  });
});
