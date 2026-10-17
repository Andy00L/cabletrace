import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConsoleSkeleton } from "@/components/console/ConsoleSkeleton";
import { ReplayConsole } from "@/components/console/ReplayConsole";
import { CABLE_CASES, findCableCase } from "@/data/cases";
import { toConsoleCase } from "@/lib/cases/case-console";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSeries } from "@/lib/cases/load-case-series";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

// Every case is curated data in the repository, so each page is prerendered at build time.
export function generateStaticParams() {
  return CABLE_CASES.map((cableCase) => ({ slug: cableCase.slug }));
}

export async function generateMetadata({ params }: PageProps<"/cases/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const cableCase = findCableCase(slug);
  return cableCase ? { title: cableCase.title, description: `${cableCase.subtitle}. ${cableCase.summary}` } : { title: "Case not found" };
}

/**
 * The replay console for one case. The data is prepared here, on the server and at build time; the console itself
 * reads its state from the URL, so it renders in the browser behind a skeleton of its own shape.
 */
export default async function CasePage({ params }: PageProps<"/cases/[slug]">) {
  const { slug } = await params;
  const cableCase = findCableCase(slug);
  if (!cableCase) notFound();

  const input = toReplaySceneInput(cableCase);
  const [series, sketches] = await Promise.all([loadCaseSeries(input), Promise.all(CABLE_CASES.map((oneCase) => loadCaseSketch(toReplaySceneInput(oneCase))))]);
  const switcherCases = CABLE_CASES.map((oneCase, index) => ({
    slug: oneCase.slug,
    title: oneCase.title,
    subtitle: oneCase.subtitle,
    vesselName: oneCase.vessel.name,
    sketch: sketches[index] ?? null,
  }));

  return (
    <main>
      <Suspense fallback={<ConsoleSkeleton title={cableCase.title} subtitle={cableCase.subtitle} summary={cableCase.summary} />}>
        <ReplayConsole input={input} consoleCase={toConsoleCase(cableCase)} series={series} switcherCases={switcherCases} />
      </Suspense>
    </main>
  );
}
