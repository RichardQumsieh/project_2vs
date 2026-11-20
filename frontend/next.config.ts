import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;
