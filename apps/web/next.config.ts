import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pactlane/db"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
};

export default nextConfig;
