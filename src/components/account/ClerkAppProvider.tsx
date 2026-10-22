import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

// Clerk's form takes the house tokens; the values are copied from src/app/globals.css (@theme) because Clerk reads
// plain colors, not CSS variables.
const CLERK_APPEARANCE = {
  // Under Tailwind's utilities (src/app/globals.css declares the layer order), so classes passed to Clerk win.
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "#1C1A16",
    colorText: "#1C1A16",
    colorTextSecondary: "#5F584C",
    colorBackground: "#FBF7EE",
    colorInputBackground: "#F2EADA",
    colorDanger: "#D93A26",
    colorSuccess: "#2E9E5B",
    fontFamily: "var(--font-tiktok-sans), 'TikTok Sans Fallback', sans-serif",
    borderRadius: "12px",
  },
};

// What an account is for, under the form's title (board 16).
const CLERK_LOCALIZATION = {
  signIn: { start: { title: "Sign in to CableTrace", subtitle: "An account opens the console, the live watch and your watchlist. Anyone can create one." } },
  signUp: { start: { title: "Create your CableTrace account", subtitle: "It opens the console, the live watch and your watchlist." } },
};

// After sign-in Clerk follows the `redirect_url` the proxy set, but only to this site: with a non-empty list, Clerk
// allows the current origin plus the listed ones, and this one can never be a real origin (.invalid is reserved by
// RFC 2606). Without it, Clerk would also accept any *.accounts.dev address, which anyone can create.
// sourceRef: node_modules/@clerk/shared/dist/internal/clerk-js/url.mjs (isAllowedRedirect, createAllowedRedirectOrigins).
const SAME_ORIGIN_ONLY = ["https://same-origin-only.invalid"];
// Where a reader lands after signing in from the landing page or the header, with no page to go back to: the console.
const AFTER_SIGN_IN_PATH = "/cases/eagle-s-2024";

/**
 * Clerk for the pages behind sign-in (cases, live, diagnostics, watchlist) and the sign-in pages. The landing page
 * stays outside it, so it carries none of Clerk's script. Clerk's browser script keeps the short-lived session cookie
 * fresh, which the data APIs these pages call need.
 */
export function ClerkAppProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={CLERK_APPEARANCE}
      localization={CLERK_LOCALIZATION}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl={AFTER_SIGN_IN_PATH}
      signUpFallbackRedirectUrl={AFTER_SIGN_IN_PATH}
      allowedRedirectOrigins={SAME_ORIGIN_ONLY}
    >
      {children}
    </ClerkProvider>
  );
}
