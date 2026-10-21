import type { NextConfig } from "next";

// Sent with every response. No page may be framed by another site (the sign-in and watchlist pages above all), no file
// is sniffed into another type, and other sites learn only this origin from links. The referrer policy must not be
// no-referrer: browsers would then send "Origin: null" and /api/watchlist would refuse every change.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
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
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The seabed area files and the terrain worker are fetched with a content version in their URL
      // (src/lib/seabed/seabed-urls.ts), so a browser may keep each for a year without asking again.
      { source: "/seabed/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
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
