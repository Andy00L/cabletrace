import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ArtPicture } from "@/components/landing/ArtPicture";

// Supabase Auth's built-in mailer reaches only the project's team (src/lib/auth/account-actions.ts), so no email is
// sent and there is no password reset yet.
const ACCOUNTS_NOTE = "No email is sent: an account opens as soon as it is created. There is no password reset yet.";

/** The form's plate, empty: holds the form's place while the page reads its query. */
export function AccountFormPlate() {
  return <div className="h-[460px] w-full rounded-card border border-ink/20 bg-paper shadow-raised" aria-busy="true" />;
}

/**
 * The sign-in and sign-up pages (board 16): the threads engraving rising from the bottom of the paper, the mark and
 * the art credit on top, the form centred. Signed-out readers of any app page land here and go back afterwards.
 */
export function AccountPage({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-paper" data-testid={testId}>
      <div className="art-dissolve-top pointer-events-none absolute inset-x-0 bottom-0" aria-hidden="true">
        <ArtPicture desktop="art-3" phone="art-3-phone" alt="" />
      </div>
      <header className="relative z-10 mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="CableTrace home" className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-full px-2 text-ink">
          <BrandMark size={28} />
          <span className="text-card-title">CableTrace</span>
        </Link>
        <p className="hidden text-micro text-muted sm:block">Art generated with Google Nano Banana</p>
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center gap-4 px-4 pt-6 pb-10 sm:pt-10">
        <div className="w-full max-w-[420px]">{children}</div>
        <p className="max-w-[420px] rounded-field bg-paper/85 px-3 py-2 text-center text-caption font-normal text-muted">{ACCOUNTS_NOTE}</p>
      </main>
    </div>
  );
}
