import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = { title: "Create an account", description: "Create an account to keep a watchlist of cases, cables and ships." };

/** Clerk's sign-up form, reached from the sign-in form's link. */
export default function SignUpPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-6 sm:px-6">
      <SiteHeader current="watchlist" />
      <main className="grid flex-1 place-items-center py-10">
        {/* Clerk's form reads the URL, so it renders in the browser behind a card of its size. */}
        <Suspense fallback={<div className="h-[420px] w-[400px] max-w-full rounded-card bg-card shadow-card" aria-busy="true" />}>
          <SignUp />
        </Suspense>
      </main>
    </div>
  );
}
