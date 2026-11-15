export function b64ToBytes(value: string) {
  return Buffer.from(value, "base64");
}

export function bytesToB64(value: Buffer | Uint8Array) {
  return Buffer.from(value).toString("base64");
}

export function publicUser(user: {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

export function directKeyFor(a: string, b: string) {
  return [a, b].sort().join(":");
}
