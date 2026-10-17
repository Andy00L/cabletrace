import type { Metadata } from "next";
import { CaseCard } from "@/components/cases/CaseCard";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CABLE_CASES } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

const INTRO = "Baltic cable cuts replayed in 3D from the published record. Every position says how it is known.";

export const metadata: Metadata = {
  title: "Cases",
  description: INTRO,
};

// Every case with its sketch, newest incident first, four to a row from 1,024 px so two rows fit one screen
// (board 12b). The sketches are read from the seabed files at build time.
export default async function CasesPage() {
  const sketches = await Promise.all(CABLE_CASES.map((cableCase) => loadCaseSketch(toReplaySceneInput(cableCase))));
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-6 sm:px-6">
      <SiteHeader current="cases" />
      <main className="flex flex-col gap-5 pt-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-baseline lg:gap-5">
          <h1 className="text-title">Cases</h1>
          <p className="text-body text-muted">{INTRO}</p>
        </div>
        <div className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="case-list">
          {CABLE_CASES.map((cableCase, index) => (
            <CaseCard key={cableCase.slug} cableCase={cableCase} sketch={sketches[index] ?? null} layout="tile" />
          ))}
        </div>
      </main>
    </div>
  );
}
