export function isKnownLocalDevice(input: {
  hasVault: boolean;
  vaultVersion: number | undefined;
  accountVaultVersion: number;
  deviceId: string | undefined;
  accountDeviceIds: readonly string[];
}) {
  if (!input.hasVault || !input.deviceId) return false;
  if (!input.accountDeviceIds.includes(input.deviceId)) return false;
  return (input.vaultVersion ?? 1) === input.accountVaultVersion;
}
