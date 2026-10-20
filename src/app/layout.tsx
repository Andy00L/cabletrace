import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { TikTok_Sans } from "next/font/google";
import { REGIONS } from "@/data/regions";
import "./globals.css";

// next/font has no metrics for TikTok Sans (with its default fallback the build warned "Failed to find font override
// values"), so it shipped no size-adjusted fallback and body text reflowed when the web font swapped in (CLS 0.011 to 0.020 per load on a
// 150 ms, 1.6 Mbps network; docs/PERFORMANCE.md). This face makes Arial take TikTok Sans's width at the body
// setting (weight 400, optical size 16): 0.4761 em average glyph width against Arial's 0.4563 em, measured in
// Chromium on Next's own sample string (next/dist/compiled/@next/font/dist/local/get-fallback-metrics-from-font-file.js).
// Ascent 1000 and descent 300 per 1000 units come from the font file, divided by the size adjustment.
// Liberation Sans, on most Linux systems, has Arial's advance widths, so the same adjustments hold for it.
// The family name must match the literal in the TikTok_Sans `fallback` option below (font loader options are literals only).
// Headings (weight 600) get their own fallback: Arial Bold runs 8% wider than TikTok Sans at 600, so the landing's
// headline wrapped to three lines in the fallback and jumped to two when the font arrived (CLS 0.06 to 0.12 on the 3G
// phone profile). 91.8% is the measured width ratio on the landing's two headlines (670.8 / 731.9 px and
// 610.0 / 663.3 px at 32 px, Chromium, 2026-10-20); the overrides keep the same 1000 / 300 metrics.
const FALLBACK_FONT_FACE = `@font-face{font-family:"TikTok Sans Fallback";src:local("Arial"),local("ArialMT"),local("Liberation Sans"),local("LiberationSans");size-adjust:104.34%;ascent-override:95.84%;descent-override:28.75%;line-gap-override:0%}@font-face{font-family:"TikTok Sans Fallback Heading";src:local("Arial Bold"),local("Arial-BoldMT"),local("Liberation Sans Bold"),local("LiberationSans-Bold");font-weight:600 700;size-adjust:91.8%;ascent-override:108.93%;descent-override:32.68%;line-gap-override:0%}`;

// The one UI family (docs/UI_DESIGN_SYSTEM.md, Type): variable weight plus the optical size axis.
const tiktokSans = TikTok_Sans({
  variable: "--font-tiktok-sans",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  fallback: ["TikTok Sans Fallback"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "CableTrace", template: "%s | CableTrace" },
  description: `Subsea cable cuts by ships, replayed in 3D from the published record, and a live watch over ships near cables in ${REGIONS.length} regions.`,
};

// The heading stack: the web font's own family name (next/font names it), then the heading fallback above.
const WEB_FONT_FAMILY = tiktokSans.style.fontFamily.split(",")[0] ?? "sans-serif";
const headingFontStyle: CSSProperties & Record<`--${string}`, string> = {
  "--font-heading": `${WEB_FONT_FAMILY}, "TikTok Sans Fallback Heading", system-ui, sans-serif`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${tiktokSans.variable} h-full`} style={headingFontStyle}>
      <head>
        <style>{FALLBACK_FONT_FACE}</style>
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
