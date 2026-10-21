import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountForm } from "@/components/account/AccountForm";
import { AccountFormPlate, AccountPage } from "@/components/account/AccountPage";
import { readSafeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Create an account", description: "Create an account to open the CableTrace console, the live watch and your watchlist." };

/** The form, sending the new reader on to the `next` page afterwards; the query is read per request. */
async function SignUpForm({ searchParams }: { searchParams: PageProps<"/sign-up">["searchParams"] }) {
  const { next } = await searchParams;
  return <AccountForm mode="sign-up" nextPath={readSafeNextPath(next)} />;
}

/** Email and password, reached from the sign-in form's link; the account opens at once, with no email to confirm. */
export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <AccountPage testId="sign-up-page">
      <Suspense fallback={<AccountFormPlate />}>
        <SignUpForm searchParams={searchParams} />
      </Suspense>
    </AccountPage>
  );
}
