import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

// Clerk's script loads only on the account pages (sign-in, sign-up, the watchlist), so the case pages, home and
// /live carry none of it. Its form takes the house tokens; the values are copied from src/app/globals.css (@theme)
// because Clerk reads plain colors, not CSS variables.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#141414",
    colorText: "#141414",
    colorTextSecondary: "#62625D",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#F3F3F1",
    colorDanger: "#D93A26",
    colorSuccess: "#2E9E5B",
    fontFamily: "var(--font-tiktok-sans), 'TikTok Sans Fallback', sans-serif",
    borderRadius: "12px",
  },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={CLERK_APPEARANCE} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/watchlist" signUpFallbackRedirectUrl="/watchlist">
      {children}
    </ClerkProvider>
  );
}
