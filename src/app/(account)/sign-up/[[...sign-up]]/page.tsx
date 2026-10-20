import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { ACCOUNT_FORM_APPEARANCE, AccountPage } from "@/components/account/AccountPage";

export const metadata: Metadata = { title: "Create an account", description: "Create an account to open the CableTrace console, the live watch and your watchlist." };

/** Clerk's sign-up form, reached from the sign-in form's link: Google first, then a code by email. */
export default function SignUpPage() {
  return (
    <AccountPage testId="sign-up-page">
      {/* Clerk's form reads the URL, so it renders in the browser behind a plate of its size. */}
      <Suspense fallback={<div className="h-[480px] w-full rounded-card border border-ink/20 bg-paper shadow-raised" aria-busy="true" />}>
        <SignUp appearance={ACCOUNT_FORM_APPEARANCE} />
      </Suspense>
    </AccountPage>
  );
}
