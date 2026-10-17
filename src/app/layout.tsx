import type { Metadata } from "next";
import { TikTok_Sans } from "next/font/google";
import "./globals.css";

// The one UI family (docs/UI_DESIGN_SYSTEM.md, Type): variable weight plus the optical size axis.
const tiktokSans = TikTok_Sans({
  variable: "--font-tiktok-sans",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "CableTrace", template: "%s | CableTrace" },
  description: "Forensic replay of subsea cable incidents in the Baltic Sea, from real ship positions and published cable routes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${tiktokSans.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
