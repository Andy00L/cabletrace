import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import type { CableCase } from "@/lib/cases/case-file";
import { describeTrackEvidenceBriefly } from "@/lib/cases/case-view";

/**
 * The newest case on file, set into the open water of the furrow engraving (no card): what happened, where and when,
 * how the track is known, and the way into its replay.
 */
export function NewestCaseNote({ cableCase }: { cableCase: CableCase }) {
  const cutsLabel = cableCase.cuts.map((cut) => cut.label).join(", ");
  return (
    <div className="paper-halo flex flex-col gap-2" data-testid="latest-cases">
      <p className="border-b border-ink/20 pb-2 text-caption text-muted">The newest case on file</p>
      <h2 className="pt-1 text-heading">{cableCase.title}</h2>
      <p className="text-small text-muted">{cableCase.subtitle}</p>
      <p className="text-small">
        {cutsLabel} cut. {describeTrackEvidenceBriefly(cableCase)}, <span className="tabular-nums">{cableCase.sources.length}</span> sources, every quote linked.
      </p>
      <Link href={`/cases/${cableCase.slug}`} className="-mx-2 mt-1 flex min-h-11 w-fit items-center gap-1 rounded-full px-2 text-label hover:bg-ink/5" data-testid={`case-card-${cableCase.slug}`}>
        Open the replay
        <Icon name="chevronRight" />
      </Link>
    </div>
  );
}
