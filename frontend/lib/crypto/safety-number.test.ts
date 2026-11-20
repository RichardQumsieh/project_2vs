import { describe, expect, it } from "vitest";
import { bytesToB64 } from "./bytes";
import {
  SAFETY_NUMBER_QR_PREFIX,
  SafetyNumberError,
  accountFingerprint,
  bytesToHex,
  directSafetyNumber,
  groupSafetyNumber,
} from "./safety-number";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const carol = "33333333-3333-4333-8333-333333333333";
const alicePhone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const aliceLaptop = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const bobPhone = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function key(byte: number): string {
  return bytesToB64(new Uint8Array(32).fill(byte));
}

const aliceDevice = {
  deviceId: alicePhone,
  identityPublicKey: key(1),
  signingPublicKey: key(2),
};
const bobDevice = {
  deviceId: bobPhone,
  identityPublicKey: key(3),
  signingPublicKey: key(4),
};

describe("safety numbers", () => {
  it("shows the same 60-digit direct number to both people", async () => {
    const forward = await directSafetyNumber(
      { userId: alice, devices: [aliceDevice] },
      { userId: bob, devices: [bobDevice] },
    );
    const backward = await directSafetyNumber(
      { userId: bob, devices: [bobDevice] },
      { userId: alice, devices: [aliceDevice] },
    );
    expect(forward.digits).toBe(backward.digits);
    expect(forward.digits).toMatch(/^\d{60}$/);
    expect(forward.groups).toHaveLength(12);
    expect(forward.groups.every((group) => /^\d{5}$/.test(group))).toBe(true);
    expect(forward.grouped).toBe(forward.groups.join(" "));
    expect(forward.qrPayload).toBe(`${SAFETY_NUMBER_QR_PREFIX}${forward.digits}`);
    expect(forward.qrPayload.includes(aliceDevice.identityPublicKey)).toBe(false);
    expect(forward.digits).toBe("416190275993008104723164066122391718359056827277913608363477");
  });

  it("changes when an identity key, signing key, device id, or device is added", async () => {
    const original = await directSafetyNumber(
      { userId: alice, devices: [aliceDevice] },
      { userId: bob, devices: [bobDevice] },
    );
    const replacedIdentity = await directSafetyNumber(
      { userId: alice, devices: [{ ...aliceDevice, identityPublicKey: key(9) }] },
      { userId: bob, devices: [bobDevice] },
    );
    const replacedSigning = await directSafetyNumber(
      { userId: alice, devices: [{ ...aliceDevice, signingPublicKey: key(8) }] },
      { userId: bob, devices: [bobDevice] },
    );
    const replacedDevice = await directSafetyNumber(
      { userId: alice, devices: [{ ...aliceDevice, deviceId: aliceLaptop }] },
      { userId: bob, devices: [bobDevice] },
    );
    const addedDevice = await directSafetyNumber(
      { userId: alice, devices: [aliceDevice, { ...aliceDevice, deviceId: aliceLaptop, identityPublicKey: key(5), signingPublicKey: key(6) }] },
      { userId: bob, devices: [bobDevice] },
    );
    expect(new Set([
      original.digits,
      replacedIdentity.digits,
      replacedSigning.digits,
      replacedDevice.digits,
      addedDevice.digits,
    ]).size).toBe(5);
  });

  it("ignores device order and treats an empty device list as its own fingerprint", async () => {
    const first = await accountFingerprint(alice, [aliceDevice, { ...aliceDevice, deviceId: aliceLaptop, identityPublicKey: key(5), signingPublicKey: key(6) }]);
    const second = await accountFingerprint(alice, [{ ...aliceDevice, deviceId: aliceLaptop, identityPublicKey: key(5), signingPublicKey: key(6) }, aliceDevice]);
    expect(bytesToHex(first)).toBe(bytesToHex(second));
    const none = await accountFingerprint(alice, []);
    const one = await accountFingerprint(alice, [aliceDevice]);
    expect(bytesToHex(none)).not.toBe(bytesToHex(one));
  });

  it("uses one group number regardless of member order, and changes when the roster changes", async () => {
    const carolDevice = {
      deviceId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      identityPublicKey: key(7),
      signingPublicKey: key(8),
    };
    const forward = await groupSafetyNumber([
      { userId: carol, devices: [carolDevice] },
      { userId: alice, devices: [aliceDevice] },
      { userId: bob, devices: [] },
    ]);
    const backward = await groupSafetyNumber([
      { userId: bob, devices: [] },
      { userId: alice, devices: [aliceDevice] },
      { userId: carol, devices: [carolDevice] },
    ]);
    expect(forward.digits).toBe(backward.digits);
    expect(forward.digits).toBe("986474524283073118875789192852608116400622507612025755895084");
    const withoutCarol = await groupSafetyNumber([
      { userId: alice, devices: [aliceDevice] },
      { userId: bob, devices: [] },
    ]);
    expect(withoutCarol.digits).not.toBe(forward.digits);
  });

  it("rejects unusable keys and duplicate devices", async () => {
    await expect(accountFingerprint(alice, [{ ...aliceDevice, identityPublicKey: key(1).slice(0, 8) }])).rejects.toBeInstanceOf(SafetyNumberError);
    await expect(accountFingerprint(alice, [aliceDevice, aliceDevice])).rejects.toBeInstanceOf(SafetyNumberError);
    await expect(directSafetyNumber(
      { userId: alice, devices: [aliceDevice] },
      { userId: alice, devices: [aliceDevice] },
    )).rejects.toBeInstanceOf(SafetyNumberError);
  });
});
