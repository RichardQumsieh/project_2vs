import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AVATAR_JSON_MAX, publicAvatar, updateAvatarSchema } from "../src/avatar.ts";
import { publicUser } from "../src/util.ts";

const avatar = {
  v: 1,
  body: "average",
  head: "round",
  skin: "#E0B08A",
  hair: "short",
  hairColor: "#4a3428",
  eyes: "round",
  eyeColor: "#3b2a1a",
  brows: "soft",
  mouth: "smile",
  facialHair: "none",
  glasses: "none",
  accessory: "none",
  outfit: "tee",
  top: "#6d55a5",
  accent: "#f4f1ea",
};

describe("avatar profile validation", () => {
  it("accepts a small avatar and greeting", () => {
    const result = updateAvatarSchema.safeParse({
      avatarConfig: avatar,
      greetingText: "  hey there..  ",
      greetingAnimation: "wave",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.avatarConfig?.skin, "#e0b08a");
      assert.equal(result.data.greetingText, "hey there..");
      assert.ok(JSON.stringify(result.data.avatarConfig).length < 500);
      assert.ok(JSON.stringify(result.data.avatarConfig).length <= AVATAR_JSON_MAX);
    }
  });

  it("rejects unknown parts, long greetings, and bad animations", () => {
    assert.equal(updateAvatarSchema.safeParse({
      avatarConfig: { ...avatar, cape: true },
      greetingText: "hi",
      greetingAnimation: "wave",
    }).success, false);
    assert.equal(updateAvatarSchema.safeParse({
      avatarConfig: avatar,
      greetingText: "a".repeat(81),
      greetingAnimation: "wave",
    }).success, false);
    assert.equal(updateAvatarSchema.safeParse({
      avatarConfig: avatar,
      greetingText: "hello\nthere",
      greetingAnimation: "wave",
    }).success, false);
    assert.equal(updateAvatarSchema.safeParse({
      avatarConfig: avatar,
      greetingText: "hi",
      greetingAnimation: "bow",
    }).success, false);
    assert.equal(updateAvatarSchema.safeParse({
      avatarConfig: { ...avatar, skin: "tan" },
      greetingText: null,
      greetingAnimation: null,
    }).success, false);
  });

  it("allows clearing the avatar", () => {
    const result = updateAvatarSchema.safeParse({
      avatarConfig: null,
      greetingText: null,
      greetingAnimation: null,
    });
    assert.equal(result.success, true);
  });

  it("publishes only a valid avatar alongside the photo fallback", () => {
    const user = publicUser({
      id: "u1",
      username: "ada",
      displayName: "Ada",
      avatarUrl: "https://example.invalid/a.png",
      avatarConfig: avatar,
      greetingText: "hey there..",
      greetingAnimation: "thumbs-up",
    });
    assert.equal(user.avatarUrl, "https://example.invalid/a.png");
    assert.equal(user.greetingText, "hey there..");
    assert.equal(user.greetingAnimation, "thumbs-up");
    assert.equal(user.avatarConfig?.hair, "short");
    assert.deepEqual(publicAvatar({ avatarConfig: { nope: true }, greetingText: "x\u0000", greetingAnimation: "spin" }), {
      avatarConfig: null,
      greetingText: null,
      greetingAnimation: null,
    });
  });
});
