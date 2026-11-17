import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container runs `.next/standalone/server.js` (see Dockerfile). The deploy build also sets
  // NEXT_DEPLOYMENT_ID to the commit SHA, which Next reads on its own for version-skew protection.
  output: "standalone",
  cacheComponents: true,
  async redirects() {
    return [
      { source: "/documents", destination: "/experience", permanent: true },
      { source: "/experiences/:id", destination: "/experience/:id", permanent: true },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
