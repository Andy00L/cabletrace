import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConsoleSkeleton } from "@/components/console/ConsoleSkeleton";
import { ReplayConsole } from "@/components/console/ReplayConsole";
import { CABLE_CASES, findCableCase } from "@/data/cases";
import { toConsoleCase } from "@/lib/cases/case-console";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseFileExport } from "@/lib/cases/load-case-file";
import { loadCaseSeries } from "@/lib/cases/load-case-series";
import { loadSeabedSummary } from "@/lib/seabed/load-seabed-summary";
import { chooseSceneExaggeration } from "@/lib/seabed/scene-scales";

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
  // No sketch travels with the page: the switcher and the 3D view's still fetch them from /cases/sketches when needed.
  const [series, seabedSummary, caseFile] = await Promise.all([
    loadCaseSeries(input),
    loadSeabedSummary(input.seabedArea),
    loadCaseFileExport(cableCase.slug),
  ]);
  const switcherCases = CABLE_CASES.map((oneCase) => ({ slug: oneCase.slug, title: oneCase.title, subtitle: oneCase.subtitle, vesselName: oneCase.vessel.name }));

  return (
    <main>
      <Suspense fallback={<ConsoleSkeleton title={cableCase.title} subtitle={cableCase.subtitle} summary={cableCase.summary} />}>
        <ReplayConsole
          input={input}
          consoleCase={toConsoleCase(cableCase)}
          series={series}
          switcherCases={switcherCases}
          sceneSummary={
            seabedSummary
              ? {
                  depth: seabedSummary.sources.depth,
                  cables: seabedSummary.sources.cables,
                  pipelines: seabedSummary.sources.pipelines,
                  exaggeration: chooseSceneExaggeration(seabedSummary.elevationRange),
                }
              : null
          }
          caseFileSha256={caseFile?.contentSha256 ?? null}
        />
      </Suspense>
    </main>
  );
}
