import assert from "node:assert/strict";
import test from "node:test";
import { passwordPolicyFailure, passwordRules } from "../src/password-policy.js";
import { registerSchema, resetPasswordSchema } from "../src/schemas.js";

const strong = "Correct-Horse-1battery";

test("password policy", async (t) => {
  await t.test("accepts a password with every required class", () => {
    assert.equal(passwordPolicyFailure(strong, "ada@example.com"), null);
    assert.equal(passwordRules(strong, "ada@example.com").every((rule) => rule.met), true);
  });

  await t.test("rejects passwords shorter than 12 characters", () => {
    assert.equal(passwordPolicyFailure("Aa1!aaaaaaa", "ada@example.com"), "At least 12 characters.");
  });

  await t.test("rejects missing classes", () => {
    assert.equal(passwordPolicyFailure("correct-horse-1", "ada@example.com"), "One uppercase letter.");
    assert.equal(passwordPolicyFailure("CORRECT-HORSE-1", "ada@example.com"), "One lowercase letter.");
    assert.equal(passwordPolicyFailure("Correct-Horse-battery", "ada@example.com"), "One digit.");
    assert.equal(passwordPolicyFailure("CorrectHorse1battery", "ada@example.com"), "One symbol.");
  });

  await t.test("rejects a password that contains the email local-part", () => {
    assert.equal(
      passwordPolicyFailure("Ada.Lovelace-1880!", "Ada.Lovelace@example.com"),
      "Does not contain your email name.",
    );
    assert.equal(passwordPolicyFailure(strong, "correct@example.com"), "Does not contain your email name.");
  });

  await t.test("register schema enforces the policy and a matching confirmation", () => {
    assert.equal(registerSchema.safeParse({
      username: "ada",
      email: "ada@example.com",
      password: "short",
      passwordConfirm: "short",
      displayName: "Ada",
    }).success, false);

    assert.equal(registerSchema.safeParse({
      username: "ada",
      email: "ada@example.com",
      password: "Ada.Lovelace-1880!",
      passwordConfirm: "Ada.Lovelace-1880!",
      displayName: "Ada",
    }).success, false);

    const accepted = registerSchema.safeParse({
      username: "Ada",
      email: "Ada@Example.com",
      password: strong,
      passwordConfirm: strong,
      displayName: "Ada",
    });
    assert.equal(accepted.success, true);
    if (accepted.success) {
      assert.equal(accepted.data.username, "ada");
      assert.equal(accepted.data.email, "ada@example.com");
    }
  });

  await t.test("reset schema enforces character rules without an email", () => {
    assert.equal(resetPasswordSchema.safeParse({
      token: "a".repeat(32),
      password: "correct horse battery",
      passwordConfirm: "correct horse battery",
      code: "123456",
    }).success, false);

    assert.equal(resetPasswordSchema.safeParse({
      token: "a".repeat(32),
      password: strong,
      passwordConfirm: strong,
      code: "123456",
    }).success, true);
  });
});
