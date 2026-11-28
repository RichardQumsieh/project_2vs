import { describe, expect, it } from "vitest";
import {
  AVATAR_JSON_MAX,
  avatarCacheKey,
  avatarJsonTooLarge,
  createDraft,
  defaultAvatar,
  parseAvatarConfig,
  parseGreetingAnimation,
  parseGreetingText,
  randomAvatar,
  replaceDraft,
  undoDraft,
} from "./config";
import { buildAvatar } from "./geometry";
import { createGreetingSession, prefersStaticAvatars, presentationMode } from "./greeting";
import { lookAt, perspective, transformPoint } from "./mat4";
import { poseAt } from "./pose";
import { renderAvatarPng, renderAvatarRgba } from "./thumbnail";

describe("avatar config", () => {
  it("accepts the default portrait and rejects unknown fields", () => {
    expect(parseAvatarConfig(defaultAvatar())).toEqual(defaultAvatar());
    expect(parseAvatarConfig({ ...defaultAvatar(), extra: true })).toBeNull();
    expect(parseAvatarConfig({ ...defaultAvatar(), skin: "blue" })).toBeNull();
    expect(parseAvatarConfig({ ...defaultAvatar(), hair: "ponytail" })).toBeNull();
  });

  it("keeps randomized avatars inside the schema and under the JSON limit", () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let index = 0; index < 12; index += 1) {
      const avatar = randomAvatar(rng);
      expect(parseAvatarConfig(avatar)).toEqual(avatar);
      expect(avatarCacheKey(avatar).length).toBeLessThan(500);
      expect(avatarJsonTooLarge(avatar)).toBe(false);
    }
    expect(avatarJsonTooLarge({ blob: "x".repeat(AVATAR_JSON_MAX + 1) })).toBe(true);
  });

  it("undoes the last edit and caps history", () => {
    let draft = createDraft(defaultAvatar());
    for (let index = 0; index < 40; index += 1) {
      draft = replaceDraft(draft, { ...draft.current, top: index % 2 === 0 ? "#112233" : "#445566" });
    }
    expect(draft.past.length).toBeLessThanOrEqual(30);
    const previous = draft.past[draft.past.length - 1]!;
    expect(undoDraft(draft).current).toEqual(previous);
    expect(undoDraft(createDraft(defaultAvatar()))).toEqual(createDraft(defaultAvatar()));
  });

  it("limits greeting text and animation names", () => {
    expect(parseGreetingText("  hey there..  ")).toBe("hey there..");
    expect(parseGreetingText("a".repeat(80))).toHaveLength(80);
    expect(parseGreetingText("a".repeat(81))).toBeNull();
    expect(parseGreetingText("hello\nthere")).toBeNull();
    expect(parseGreetingAnimation("thumbs-up")).toBe("thumbs-up");
    expect(parseGreetingAnimation("bow")).toBeNull();
  });
});

describe("avatar geometry", () => {
  it("stays low poly with a few draw calls and no external assets", () => {
    const model = buildAvatar(defaultAvatar());
    expect(model.stats.triangles).toBeGreaterThan(20);
    expect(model.stats.triangles).toBeLessThan(1600);
    expect(model.stats.vertices).toBeLessThan(2500);
    expect(model.stats.drawCalls).toBeLessThanOrEqual(4);
    expect(model.meshes.every((mesh) => mesh.indices.length % 3 === 0)).toBe(true);
    expect(model.meshes.every((mesh) => mesh.colors.length === mesh.positions.length)).toBe(true);
  });

  it("moves the waving arm and puts the portrait in front of the camera", () => {
    const down = poseAt("wave", 0, true).armRRotX;
    const up = poseAt("wave", 700, true).armRRotX;
    expect(up).toBeLessThan(down);
    expect(poseAt("wave", 5000, true).armRRotX).toBe(0);
    const model = buildAvatar(defaultAvatar());
    const head = model.meshes.find((mesh) => mesh.group === "head")!;
    const worldY = model.pivots.head[1] + head.positions[1]!;
    const projection = perspective((28 * Math.PI) / 180, 1, 0.1, 20);
    const view = lookAt([0, 1.15, 2.7], [0, 1.05, 0], [0, 1, 0]);
    const clip = transformPoint(projection, ...transformPoint(view, 0, worldY, 0));
    expect(Math.abs(clip[0])).toBeLessThan(1.2);
    expect(Math.abs(clip[1])).toBeLessThan(1.2);
  });
});

describe("avatar thumbnail", () => {
  it("renders a small PNG snapshot whose pixels follow the avatar", () => {
    const png = renderAvatarPng(defaultAvatar());
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.byteLength).toBeLessThan(20_000);
    const brunette = renderAvatarRgba({ ...defaultAvatar(), hair: "long", hairColor: "#1b1b1f" });
    const blonde = renderAvatarRgba({ ...defaultAvatar(), hair: "long", hairColor: "#d4a017" });
    let changed = 0;
    let painted = 0;
    for (let index = 0; index < brunette.length; index += 4) {
      if (brunette[index + 3]) painted += 1;
      if (brunette[index] !== blonde[index] || brunette[index + 1] !== blonde[index + 1]) changed += 1;
    }
    expect(painted).toBeGreaterThan(40);
    expect(changed).toBeGreaterThan(8);
  });
});

describe("avatar greeting", () => {
  it("plays once per contact and waves once for a new conversation", () => {
    const session = createGreetingSession();
    const first = session.enter({
      contactId: "ada",
      conversationId: "chat-1",
      isNew: true,
      hasAvatar: true,
      animation: "nod",
      text: "hey there..",
    });
    expect(first).toEqual({ animation: "nod", text: "hey there..", live: true });
    expect(session.enter({
      contactId: "ada",
      conversationId: "chat-1",
      isNew: false,
      hasAvatar: true,
      animation: "nod",
      text: "hey there..",
    })).toBeNull();
    expect(session.enter({
      contactId: "ada",
      conversationId: "chat-2",
      isNew: true,
      hasAvatar: true,
      animation: "nod",
      text: "hey there..",
    })).toEqual({ animation: "subtleWave", text: null, live: true });
    expect(session.enter({
      contactId: "bea",
      conversationId: "chat-3",
      isNew: false,
      hasAvatar: false,
      animation: null,
      text: "hello",
    })).toMatchObject({ live: false, text: "hello" });
  });

  it("falls back to a still image when motion is reduced or GL fails", () => {
    expect(prefersStaticAvatars({ staticAvatars: false, speakGreetings: false }, true)).toBe(true);
    expect(presentationMode({ focused: true, staticAvatars: false, glFailed: false })).toBe("live");
    expect(presentationMode({ focused: false, staticAvatars: false, glFailed: false })).toBe("still");
    expect(presentationMode({ focused: true, staticAvatars: true, glFailed: false })).toBe("still");
    expect(presentationMode({ focused: true, staticAvatars: false, glFailed: true })).toBe("still");
  });
});
