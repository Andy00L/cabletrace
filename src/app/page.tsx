import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { RecorderStatusCard, RecorderStatusCardPlaceholder } from "@/components/recorder/RecorderStatusCard";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 pt-8 pb-16 sm:px-16 sm:pt-14">
      <SiteHeader />
      <section className="flex max-w-[640px] flex-col gap-3">
        <h1 className="text-title">Ship traffic over Baltic subsea cables</h1>
        <p className="text-body text-muted">
          CableTrace records every ship that passes near a cable or pipeline in the Gulf of Finland, once a minute, so a cable
          break can be traced back to the ships that were there. Case replays of past incidents come next.
        </p>
      </section>
      <div className="grid items-start gap-4 md:grid-cols-[3fr_2fr]">
        <Suspense fallback={<RecorderStatusCardPlaceholder />}>
          <RecorderStatusCard />
        </Suspense>
        <Link
          href="/diagnostics"
          className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card transition-shadow duration-140 ease-standard hover:shadow-raised sm:p-7"
          data-testid="diagnostics-link"
        >
          <h2 className="text-card-title">WebGL check</h2>
          <p className="text-small text-muted">
            Draws the map and a 3D seabed in this browser, then reports the graphics renderer and the frame time.
          </p>
          <span className="flex items-center gap-1 text-label text-ink">
            Open diagnostics
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M8 5.5 12.5 10 8 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </Link>
      </div>
    </main>
  );
}
