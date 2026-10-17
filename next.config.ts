import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The case list, the case pages and the home page read the seabed files from disk to draw sketches and charts
  // (src/lib/cases/load-case-sketch.ts, load-case-series.ts); ship them with their server functions so a cache
  // refresh after deploy can read them too.
  outputFileTracingIncludes: {
    "/": ["./public/seabed/**"],
    "/cases": ["./public/seabed/**"],
    "/cases/[slug]": ["./public/seabed/**"],
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
