export const CLOUD_SOPHIA_PURPOSE =
  "Sophia may read authorized mail, calendar, connected work items, and messages the user has allowed, in order to propose actions";

export const CLOUD_SOPHIA_CONSENT_VERSION = "cloud-sophia-v1";

export function signupCloudConsentBody(accepted: boolean): {
  cloudSophiaConsent?: {
    accepted: true;
    purposeText: typeof CLOUD_SOPHIA_PURPOSE;
    versionId: typeof CLOUD_SOPHIA_CONSENT_VERSION;
  };
} {
  if (!accepted) return {};
  return {
    cloudSophiaConsent: {
      accepted: true,
      purposeText: CLOUD_SOPHIA_PURPOSE,
      versionId: CLOUD_SOPHIA_CONSENT_VERSION,
    },
  };
}

/**
 * Local path unless this account has cloud consent AND the turn has no
 * private-message plaintext. There is no per-thread or per-send E2EE flag,
 * so a turn that includes decrypted chat stays on-device.
 */
export function decideCloudSophiaPath(input: {
  consentActive: boolean;
  hasPrivateMessagePlaintext: boolean;
}): "local" | "cloud" {
  if (!input.consentActive || input.hasPrivateMessagePlaintext) {
    return "local";
  }
  return "cloud";
}
