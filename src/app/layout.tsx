import type { Metadata } from "next";
import { TikTok_Sans } from "next/font/google";
import "./globals.css";

// next/font has no metrics for TikTok Sans (with its default fallback the build warned "Failed to find font override
// values"), so it shipped no size-adjusted fallback and body text reflowed when the web font swapped in (CLS 0.011 to 0.020 per load on a
// 150 ms, 1.6 Mbps network; docs/PERFORMANCE.md). This face makes Arial take TikTok Sans's width at the body
// setting (weight 400, optical size 16): 0.4761 em average glyph width against Arial's 0.4563 em, measured in
// Chromium on Next's own sample string (next/dist/compiled/@next/font/dist/local/get-fallback-metrics-from-font-file.js).
// Ascent 1000 and descent 300 per 1000 units come from the font file, divided by the size adjustment.
// The family name must match the literal in the TikTok_Sans `fallback` option below (font loader options are literals only).
const FALLBACK_FONT_FACE = `@font-face{font-family:"TikTok Sans Fallback";src:local("Arial"),local("ArialMT");size-adjust:104.34%;ascent-override:95.84%;descent-override:28.75%;line-gap-override:0%}`;

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
  description: "Forensic replay of subsea cable incidents in the Baltic Sea, from real ship positions and published cable routes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${tiktokSans.variable} h-full`}>
      <head>
        <style>{FALLBACK_FONT_FACE}</style>
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
