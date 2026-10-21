import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountForm } from "@/components/account/AccountForm";
import { AccountFormPlate, AccountPage } from "@/components/account/AccountPage";
import { readSafeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to open the CableTrace console, the live watch and your watchlist." };

/** The form, sending the reader on to the `next` page afterwards; the query is read per request. */
async function SignInForm({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const { next } = await searchParams;
  return <AccountForm mode="sign-in" nextPath={readSafeNextPath(next)} />;
}

/** Email and password (Supabase Auth). Afterwards the reader goes back to the page that sent them here, or to the console. */
export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <AccountPage testId="sign-in-page">
      <Suspense fallback={<AccountFormPlate />}>
        <SignInForm searchParams={searchParams} />
      </Suspense>
    </AccountPage>
  );
}
