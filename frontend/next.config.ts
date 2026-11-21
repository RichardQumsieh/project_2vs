import type { NextConfig } from "next";
import { LEGACY_ACTIVITY_PATH, legacyActivityRedirect } from "./lib/inbox-hub";

const nextConfig: NextConfig = {
  // Agent policy lives in frontend/lib/ai/agent-control.ts (kept in sync with
  // backend/src/agent-control.ts) so Cursor publish of project_dir=frontend
  // does not need the rest of the monorepo on disk.
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
