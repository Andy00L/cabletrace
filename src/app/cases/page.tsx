import type { Metadata } from "next";
import { CaseCard } from "@/components/cases/CaseCard";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CABLE_CASES } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

export const metadata: Metadata = {
  title: "Cases",
  description: "Baltic cable cuts replayed in 3D from the published record. Every position says how it is known.",
};

// Every case with its sketch, newest incident first. The sketches are read from the seabed files at build time.
export default async function CasesPage() {
  const sketches = await Promise.all(CABLE_CASES.map((cableCase) => loadCaseSketch(toReplaySceneInput(cableCase))));
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 pt-8 pb-16 sm:px-16 sm:pt-14">
      <SiteHeader />
      <section className="flex max-w-[640px] flex-col gap-3">
        <h1 className="text-title">Cases</h1>
        <p className="text-body text-muted">Baltic cable cuts replayed in 3D from the published record. Every position says how it is known.</p>
      </section>
      <div className="grid items-start gap-6 md:grid-cols-2" data-testid="case-list">
        {CABLE_CASES.map((cableCase, index) => (
          <CaseCard key={cableCase.slug} cableCase={cableCase} sketch={sketches[index] ?? null} />
        ))}
      </div>
    </main>
  );
}
