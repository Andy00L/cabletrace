import Link from "next/link";
import { CaseSketchMap } from "@/components/cases/CaseCard";
import { Icon } from "@/components/icons/Icon";
import { Plate } from "@/components/landing/Plate";
import type { CableCase } from "@/lib/cases/case-file";
import type { CaseSketch } from "@/lib/cases/case-sketch";
import { describeTrackEvidenceBriefly } from "@/lib/cases/case-view";

/** The newest case on file as a printed plate floating on the furrow engraving (board 13): its sketch, date and title. */
export function NewestCasePlate({ cableCase, sketch }: { cableCase: CableCase; sketch: CaseSketch | null }) {
  const cutsLabel = cableCase.cuts.map((cut) => cut.label).join(", ");
  return (
    <Plate className="w-full max-w-[340px]" testId="latest-cases">
      <Link href={`/cases/${cableCase.slug}`} className="flex flex-col gap-1.5 rounded-card p-2.5 pb-4" data-testid={`case-card-${cableCase.slug}`}>
        <div className="aspect-[4/3] overflow-hidden rounded-inner bg-depth-40">{sketch && <CaseSketchMap sketch={sketch} vesselName={cableCase.vessel.name} />}</div>
        <span className="mt-3 px-1.5 text-caption text-muted">{cableCase.subtitle}</span>
        <h3 className="px-1.5 text-heading">{cableCase.title}</h3>
        <span className="px-1.5 text-small text-muted">
          {cutsLabel} cut. {describeTrackEvidenceBriefly(cableCase)}, <span className="tabular-nums">{cableCase.sources.length}</span> sources.
        </span>
        <span className="mt-2 flex items-center gap-1 px-1.5 text-label">
          Open the replay
          <Icon name="chevronRight" />
        </span>
      </Link>
    </Plate>
  );
}
