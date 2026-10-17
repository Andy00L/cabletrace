import Link from "next/link";
import { Suspense } from "react";
import { CaseCard } from "@/components/cases/CaseCard";
import { Icon } from "@/components/icons/Icon";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { RecorderStatusCard, RecorderStatusCardPlaceholder } from "@/components/recorder/RecorderStatusCard";
import { CABLE_CASES } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

// The home page shows this many of the newest cases; the rest are one click away on the case list.
const LATEST_CASE_COUNT = 2;

/**
 * Home on one screen from 1,024 px (board 12a): what CableTrace does and the live recorder on the left, the newest
 * case replays on the right sharing the height. Narrower screens stack the two columns and scroll.
 */
export default async function HomePage() {
  const latestCases = CABLE_CASES.slice(0, LATEST_CASE_COUNT);
  const sketches = await Promise.all(latestCases.map((cableCase) => loadCaseSketch(toReplaySceneInput(cableCase))));
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-6 sm:px-6 lg:h-dvh">
      <SiteHeader current="home" />
      <main className="grid min-h-0 flex-1 gap-6 pt-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          <h1 className="text-title">Ship traffic over Baltic subsea cables</h1>
          <p className="text-body text-muted">
            CableTrace records every ship near a Gulf of Finland cable once a minute, so a break can be traced to the ships that
            were there. Past cuts replay in 3D, every position tied to its source.
          </p>
          <div className="mt-2">
            <Suspense fallback={<RecorderStatusCardPlaceholder />}>
              <RecorderStatusCard />
            </Suspense>
          </div>
          <Link
            href="/live"
            prefetch={false}
            className="flex items-center gap-3.5 rounded-row bg-card px-5 py-4 shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised lg:mt-auto"
            data-testid="live-link"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-label">A recorded day at sea</span>
              <span className="text-caption font-normal text-muted">Every ship the feeds heard in the last 24 hours, on a globe</span>
            </span>
            <span className="ml-auto text-muted">
              <Icon name="chevronRight" />
            </span>
          </Link>
        </section>
        <section className="flex min-h-0 min-w-0 flex-col gap-3.5" aria-labelledby="case-replays-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="case-replays-title" className="text-card-title">
              Case replays
            </h2>
            <Link href="/cases" className="-mx-2 flex min-h-11 items-center gap-1 rounded-full px-2 text-label text-ink" data-testid="all-cases-link">
              All cases
              <Icon name="chevronRight" />
            </Link>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3.5" data-testid="latest-cases">
            {latestCases.map((cableCase, index) => (
              <CaseCard key={cableCase.slug} cableCase={cableCase} sketch={sketches[index] ?? null} layout="wide" />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
