import { isIP } from "node:net";

export function networkPrefixForIp(ip: string): string | null {
  const normalized = ip.trim().toLowerCase().split("%")[0];
  if (!normalized) return null;

  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const address = mappedIpv4?.[1] ?? normalized;
  const family = isIP(address);

  if (family === 4) {
    const octets = address.split(".");
    return `v4:${octets.slice(0, 3).join(".")}`;
  }
  if (family !== 6) return null;

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  if (groups.length !== 8) return null;
  return `v6:${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}`;
}
