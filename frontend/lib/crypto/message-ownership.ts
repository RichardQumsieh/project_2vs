export function isMessageFromUser(
  senderUserId: string | undefined,
  senderDeviceId: string,
  userId: string | null,
  deviceId: string | null,
) {
  if (senderUserId) {
    return senderUserId === userId;
  }
  return Boolean(deviceId && senderDeviceId === deviceId);
}
