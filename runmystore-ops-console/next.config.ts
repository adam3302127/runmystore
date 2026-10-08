import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Every console screen is per-user and live, so render dynamically (no component cache).
  cacheComponents: false,
  turbopack: {
    // This app lives inside the runmystore repo; pin the workspace root so dev-mode watching stays in this folder.
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  agentRules: false,
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
