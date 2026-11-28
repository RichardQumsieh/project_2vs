import type { ThemeWallpaper } from "./tokens";
import { isHex } from "./tokens";

function assertColors(colors: string[]): string[] {
  if (colors.some((color) => !isHex(color))) {
    throw new Error("Wallpaper colors must be hex.");
  }
  return colors.map((color) => color.toLowerCase());
}

/** Geometric wallpaper from structured colors. No external references, text, or images. */
export function wallpaperSvg(wallpaper: ThemeWallpaper, width = 360, height = 720): string {
  const colors = assertColors(wallpaper.colors);
  const [first, second, third = first, fourth = second] = colors;
  const angle = ((Math.round(wallpaper.angle) % 360) + 360) % 360;
  const body = motif(wallpaper.motif, { first, second, third, fourth, angle, width, height });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <defs>
    <linearGradient id="wash" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="${height}" gradientTransform="rotate(${angle} ${width / 2} ${height / 2})">
      <stop offset="0" stop-color="${first}"/>
      <stop offset="0.55" stop-color="${second}"/>
      <stop offset="1" stop-color="${third}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#wash)"/>
  ${body}
</svg>`;
}

function motif(
  kind: ThemeWallpaper["motif"],
  ink: { first: string; second: string; third: string; fourth: string; angle: number; width: number; height: number },
): string {
  const { second, fourth, width, height } = ink;
  if (kind === "gradient") return "";
  if (kind === "dots") {
    return `<g fill="${fourth}" opacity="0.35">${dotGrid(width, height)}</g>`;
  }
  if (kind === "grid") {
    const lines: string[] = [];
    for (let x = 24; x < width; x += 24) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${fourth}" stroke-width="1" opacity="0.35"/>`);
    for (let y = 24; y < height; y += 24) lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${second}" stroke-width="1" opacity="0.25"/>`);
    return lines.join("");
  }
  if (kind === "rings") {
    const rings: string[] = [];
    for (let radius = 40; radius <= 280; radius += 36) {
      rings.push(`<circle cx="${width / 2}" cy="${height / 3}" r="${radius}" fill="none" stroke="${fourth}" stroke-width="2" opacity="0.35"/>`);
    }
    return rings.join("");
  }
  if (kind === "rays") {
    const rays: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const theta = (Math.PI * 2 * index) / 12;
      const x = width / 2 + Math.cos(theta) * width;
      const y = height / 4 + Math.sin(theta) * height;
      rays.push(`<line x1="${width / 2}" y1="${height / 4}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${fourth}" stroke-width="3" opacity="0.28"/>`);
    }
    return rays.join("");
  }
  if (kind === "waves") {
    return `<path d="M0 ${height * 0.35} C ${width * 0.25} ${height * 0.25}, ${width * 0.35} ${height * 0.5}, ${width * 0.5} ${height * 0.42} S ${width * 0.8} ${height * 0.2}, ${width} ${height * 0.38}" fill="none" stroke="${fourth}" stroke-width="8" opacity="0.45"/>
      <path d="M0 ${height * 0.62} C ${width * 0.2} ${height * 0.5}, ${width * 0.4} ${height * 0.78}, ${width * 0.62} ${height * 0.66} S ${width * 0.85} ${height * 0.5}, ${width} ${height * 0.7}" fill="none" stroke="${second}" stroke-width="6" opacity="0.4"/>`;
  }
  const lines: string[] = [];
  for (let offset = -height; offset < width + height; offset += 28) {
    lines.push(`<line x1="${offset}" y1="0" x2="${offset + height}" y2="${height}" stroke="${fourth}" stroke-width="2" opacity="0.28"/>`);
  }
  return lines.join("");
}

function dotGrid(width: number, height: number): string {
  const dots: string[] = [];
  for (let y = 18; y < height; y += 28) {
    for (let x = 18; x < width; x += 28) dots.push(`<circle cx="${x}" cy="${y}" r="2.5"/>`);
  }
  return dots.join("");
}

export function wallpaperDataUri(wallpaper: ThemeWallpaper): string {
  return `data:image/svg+xml,${encodeURIComponent(wallpaperSvg(wallpaper))}`;
}

export function wallpaperIsSafe(svg: string): boolean {
  const lower = svg.toLowerCase().replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
  return (
    lower.includes("<svg") &&
    !lower.includes("<script") &&
    !lower.includes("<image") &&
    !lower.includes("foreignobject") &&
    !lower.includes("http:") &&
    !lower.includes("https:") &&
    !lower.includes("href=") &&
    !lower.includes("data:")
  );
}
