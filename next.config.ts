import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The case list reads the seabed files from disk to draw its sketches (src/lib/cases/load-case-sketch.ts);
  // ship them with its server function so a cache refresh after deploy can read them too.
  outputFileTracingIncludes: {
    "/cases": ["./public/seabed/**"],
  },
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
