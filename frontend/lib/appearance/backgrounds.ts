import type { CuratedId, GradientId } from "./schema";

/** Bundled CSS gradients. No network URLs. */
export const GRADIENT_CSS: Record<GradientId, string> = {
  dusk: "linear-gradient(160deg, #1c1738 0%, #3a315f 48%, #1a3344 100%)",
  harbor: "linear-gradient(165deg, #10243a 0%, #1d4e5f 52%, #123028 100%)",
  paper: "linear-gradient(180deg, #f6f1e6 0%, #e4edf6 100%)",
  night: "linear-gradient(180deg, #070b12 0%, #151b2e 100%)",
};

const CURATED_SVG: Record<CuratedId, string> = {
  linen:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#efe6d6"/><path d="M0 20H80M0 40H80M0 60H80M20 0V80M40 0V80M60 0V80" stroke="#e4d5bc" stroke-width="2"/></svg>',
  cedar:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#e7efe4"/><circle cx="20" cy="24" r="10" fill="#c5d7bf"/><circle cx="54" cy="50" r="14" fill="#b7c9ae"/></svg>',
  tide:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#e5f1f2"/><path d="M0 28C12 20 20 36 32 28S52 20 64 28 80 36 80 28V80H0Z" fill="#c5e0e2"/><path d="M0 48C14 40 22 56 36 48S58 40 72 48 80 56 80 48V80H0Z" fill="#a9d0d4"/></svg>',
  ink:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#121722"/><circle cx="62" cy="18" r="8" fill="#2a3348"/><circle cx="16" cy="58" r="12" fill="#1c2436"/></svg>',
};

export const CURATED_DATA_URI: Record<CuratedId, string> = {
  linen: svgDataUri(CURATED_SVG.linen),
  cedar: svgDataUri(CURATED_SVG.cedar),
  tide: svgDataUri(CURATED_SVG.tide),
  ink: svgDataUri(CURATED_SVG.ink),
};

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function curatedBackgroundsAreLocal(): boolean {
  return Object.values(CURATED_DATA_URI).every((uri) => {
    if (!uri.startsWith("data:image/svg+xml,")) return false;
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length)).toLowerCase();
    return (
      svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"") &&
      !svg.includes("<script") &&
      !svg.includes("foreignobject") &&
      !svg.includes("href=") &&
      !/url\(\s*['"]?https?:/.test(svg)
    );
  });
}
