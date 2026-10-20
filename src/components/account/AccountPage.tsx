import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ArtPicture } from "@/components/landing/ArtPicture";

// Clerk's development tier: production keys need a domain of our own, which *.vercel.app is not (plan/decision-log.md).
const ACCOUNTS_NOTE = "Accounts run on Clerk's development tier during the hackathon: at most 100 readers, and the form says Development mode.";

// Clerk's own elements, restyled to sit on the paper like the landing's plates (board 16): Google first, as the one ink
// action, the email code under it. Class names reach Clerk's DOM, so Tailwind sees them here.
export const ACCOUNT_FORM_APPEARANCE = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full rounded-card border border-ink/20 bg-paper shadow-raised",
    card: "bg-paper px-8 pt-8 pb-6 shadow-none",
    // Clerk paints its footer with a gradient, so the whole background is replaced, not only its colour.
    footer: "[background:var(--color-paper)]",
    headerTitle: "text-heading text-ink",
    headerSubtitle: "text-small text-muted",
    socialButtonsBlockButton: "h-12 rounded-full border-0 bg-ink text-card hover:bg-ink-hover",
    socialButtonsBlockButtonText: "text-label text-card",
    dividerText: "text-caption text-muted",
    formFieldInput: "h-11 rounded-field border-0 bg-card",
    formButtonPrimary: "h-11 rounded-full bg-soft text-label text-ink shadow-none hover:bg-ink/10",
  },
  layout: { socialButtonsPlacement: "top", socialButtonsVariant: "blockButton" },
} as const;

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
