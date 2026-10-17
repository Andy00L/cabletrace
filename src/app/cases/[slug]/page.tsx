import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AftermathCard, PlacementCard, ShipCard, SourceList } from "@/components/cases/CaseCards";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CaseReplay } from "@/components/replay/CaseReplay";
import { CABLE_CASES, findCableCase } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { toTimelineEvents } from "@/lib/cases/case-view";

// Every case is curated data in the repository, so each page is prerendered at build time.
export function generateStaticParams() {
  return CABLE_CASES.map((cableCase) => ({ slug: cableCase.slug }));
}

export async function generateMetadata({ params }: PageProps<"/cases/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const cableCase = findCableCase(slug);
  return cableCase ? { title: cableCase.title, description: `${cableCase.subtitle}. ${cableCase.summary}` } : { title: "Case not found" };
}

export default async function CasePage({ params }: PageProps<"/cases/[slug]">) {
  const { slug } = await params;
  const cableCase = findCableCase(slug);
  if (!cableCase) notFound();

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-7 px-4 pt-8 pb-16 sm:px-16 sm:pt-14">
      <SiteHeader />
      <header className="flex flex-col gap-2.5">
        <h1 className="text-title">{cableCase.title}</h1>
        <p className="max-w-[760px] text-body text-muted">
          {cableCase.subtitle}. {cableCase.summary}
        </p>
      </header>
      <CaseReplay
        input={toReplaySceneInput(cableCase)}
        events={toTimelineEvents(cableCase)}
        localTime={cableCase.localTime}
        aside={<ShipCard cableCase={cableCase} />}
        below={
          <>
            <div className="grid items-start gap-6 md:grid-cols-2">
              <PlacementCard cableCase={cableCase} />
              <AftermathCard cableCase={cableCase} />
            </div>
            <SourceList cableCase={cableCase} />
          </>
        }
      />
    </main>
  );
}
