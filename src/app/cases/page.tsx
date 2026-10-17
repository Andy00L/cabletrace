import type { Metadata } from "next";
import { CaseCard } from "@/components/cases/CaseCard";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CABLE_CASES } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { groupByCaseRegion } from "@/lib/cases/case-regions";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

const INTRO = "Subsea cable cuts by ships, replayed in 3D from the published record. Every position says how it is known.";

export const metadata: Metadata = {
  title: "Cases",
  description: INTRO,
};

// Every case with its sketch, grouped by region and newest first inside each region, as compact rows in two columns
// from 768 px and three from 1,280 px, so a dozen cases fit one screen. The sketches are read from the seabed files at
// build time.
export default async function CasesPage() {
  const sketchList = await Promise.all(CABLE_CASES.map((cableCase) => loadCaseSketch(toReplaySceneInput(cableCase))));
  const sketchesBySlug = new Map(CABLE_CASES.map((cableCase, index) => [cableCase.slug, sketchList[index] ?? null]));
  const regionGroups = groupByCaseRegion(CABLE_CASES, (cableCase) => cableCase.seabedArea);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-6 sm:px-6">
      <SiteHeader current="cases" />
      <main className="flex flex-col gap-5 pt-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-baseline lg:gap-5">
          <h1 className="text-title">Cases</h1>
          <p className="text-body text-muted">{INTRO}</p>
        </div>
        <div className="gap-5 md:columns-2 xl:columns-3" data-testid="case-list">
          {regionGroups.map((group) => (
            <section key={group.region.id} aria-labelledby={`region-${group.region.id}`} className="mb-5 flex break-inside-avoid flex-col gap-2.5" data-testid={`case-region-${group.region.id}`}>
              <h2 id={`region-${group.region.id}`} className="flex items-baseline gap-2 px-1 text-card-title">
                {group.region.name}
                <span className="text-caption font-normal text-muted tabular-nums">{group.items.length === 1 ? "1 case" : `${group.items.length} cases`}</span>
              </h2>
              {group.items.map((cableCase) => (
                <CaseCard key={cableCase.slug} cableCase={cableCase} sketch={sketchesBySlug.get(cableCase.slug) ?? null} layout="row" />
              ))}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
