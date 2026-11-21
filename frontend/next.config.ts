import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { LEGACY_ACTIVITY_PATH, legacyActivityRedirect } from "./lib/inbox-hub";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  // The inbox agent shares backend/src/agent-control.ts. Turbopack only
  // resolves files inside this root, so the root is the repo, not frontend/.
  turbopack: {
    root: repoRoot,
  },
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
  },
  async redirects() {
    return [
      {
        source: "/jarvis",
        destination: "/sophia",
        permanent: true,
      },
      {
        source: "/jarvis/:path*",
        destination: "/sophia/:path*",
        permanent: true,
      },
      {
        source: "/settings/jarvis",
        destination: "/settings/sophia",
        permanent: true,
      },
      {
        source: "/settings/jarvis/:path*",
        destination: "/settings/sophia/:path*",
        permanent: true,
      },
      {
        source: LEGACY_ACTIVITY_PATH,
        destination: legacyActivityRedirect(),
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
