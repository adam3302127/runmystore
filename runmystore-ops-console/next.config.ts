import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every console screen is per-user and live, so render dynamically (no component cache).
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
