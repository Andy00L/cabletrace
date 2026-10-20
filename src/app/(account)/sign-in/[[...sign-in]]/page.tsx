import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { ACCOUNT_FORM_APPEARANCE, AccountPage } from "@/components/account/AccountPage";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to open the CableTrace console, the live watch and your watchlist." };

/**
 * Clerk's sign-in form. Google first, then a code by email; anyone can create an account. Afterwards the reader goes
 * back to the page that sent them here, or to the console (src/components/account/ClerkAppProvider.tsx).
 */
export default function SignInPage() {
  return (
    <AccountPage testId="sign-in-page">
      {/* Clerk's form reads the URL, so it renders in the browser behind a plate of its size. */}
      <Suspense fallback={<div className="h-[440px] w-full rounded-card border border-ink/20 bg-paper shadow-raised" aria-busy="true" />}>
        <SignIn appearance={ACCOUNT_FORM_APPEARANCE} />
      </Suspense>
    </AccountPage>
  );
}
