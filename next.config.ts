import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["node:sqlite"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
export default config;
