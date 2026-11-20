/** Pull a single-use invite code out of a pasted link or a bare code. */
export function inviteCodeFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let raw = trimmed;
  if (trimmed.includes("code=")) {
    try {
      const url = new URL(trimmed, "https://sophia.local");
      raw = url.searchParams.get("code") ?? "";
    } catch {
      raw = "";
    }
  }
  const code = raw.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (code.length < 8 || code.length > 16) return null;
  return code;
}
