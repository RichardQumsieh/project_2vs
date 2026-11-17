import { describe, expect, it } from "vitest";
import { passwordIsReady, passwordPolicyFailure, passwordRules } from "./password-policy";

const strong = "Correct-Horse-1battery";

describe("password policy", () => {
  it("marks every rule met for a strong password", () => {
    expect(passwordRules(strong, "ada@example.com").every((rule) => rule.met)).toBe(true);
    expect(passwordPolicyFailure(strong, "ada@example.com")).toBeNull();
  });

  it("shows unmet rules while the password is incomplete", () => {
    const rules = passwordRules("correct", "ada@example.com");
    expect(rules.find((rule) => rule.id === "length")?.met).toBe(false);
    expect(rules.find((rule) => rule.id === "upper")?.met).toBe(false);
    expect(rules.find((rule) => rule.id === "digit")?.met).toBe(false);
    expect(rules.find((rule) => rule.id === "symbol")?.met).toBe(false);
    expect(rules.find((rule) => rule.id === "localPart")?.met).toBe(true);
  });

  it("rejects the email local-part regardless of case", () => {
    expect(passwordPolicyFailure("Ada.Lovelace-1880!", "Ada.Lovelace@example.com"))
      .toBe("Does not contain your email name.");
  });

  it("blocks submit until the confirmation matches", () => {
    expect(passwordIsReady(strong, "Correct-Horse-1batter", "ada@example.com")).toBe(false);
    expect(passwordIsReady(strong, strong, "ada@example.com")).toBe(true);
    expect(passwordIsReady("", "", "ada@example.com")).toBe(false);
  });
});
