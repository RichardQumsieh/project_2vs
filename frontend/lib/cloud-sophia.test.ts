import { describe, expect, it } from "vitest";
import {
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
  decideCloudSophiaPath,
  signupCloudConsentBody,
} from "./cloud-sophia";

describe("cloud sophia client gate", () => {
  it("leaves consent off unless the person checks it", () => {
    expect(signupCloudConsentBody(false)).toEqual({});
    expect(signupCloudConsentBody(true)).toEqual({
      cloudSophiaConsent: {
        accepted: true,
        purposeText: CLOUD_SOPHIA_PURPOSE,
        versionId: CLOUD_SOPHIA_CONSENT_VERSION,
      },
    });
    expect(CLOUD_SOPHIA_PURPOSE).toBe(
      "Sophia may read authorized mail, calendar, connected work items, and messages the user has allowed, in order to propose actions",
    );
  });

  it("does not choose the cloud path without consent or with private-message plaintext", () => {
    expect(decideCloudSophiaPath({
      consentActive: false,
      hasPrivateMessagePlaintext: false,
    })).toBe("local");
    expect(decideCloudSophiaPath({
      consentActive: true,
      hasPrivateMessagePlaintext: true,
    })).toBe("local");
    expect(decideCloudSophiaPath({
      consentActive: true,
      hasPrivateMessagePlaintext: false,
    })).toBe("cloud");
  });
});
