import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { Plate } from "@/components/landing/Plate";
import type { CableCase, CaseCut } from "@/lib/cases/case-file";

function formatLongDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * What "every position tied to its source" means, on one cut (board 13): the operator's own words, where they were
 * published, and how the replay turned them into a point. Everything comes from the case file.
 */
export function EvidencePlate({ cableCase, cut }: { cableCase: CableCase; cut: CaseCut }) {
  const citation = cut.citations[0];
  const source = citation ? cableCase.sources.find((candidate) => candidate.id === citation.sourceId) : undefined;
  const cutTime = cut.atUtc.slice(11, 16);
  return (
    <Plate className="w-full max-w-[360px]" testId="landing-evidence">
      <div className="flex flex-col gap-3 p-6">
        <p className="flex items-center gap-2 text-caption text-muted">
          <span className="relative flex size-3 flex-none items-center justify-center rounded-full border-2 border-alarm" aria-hidden="true">
            <span className="size-1 rounded-full bg-alarm" />
          </span>
          {cut.label} cut, {formatLongDate(cut.atUtc)}, {cutTime} UTC
        </p>
        <h2 className="text-heading">How a position is placed</h2>
        {citation && <blockquote className="text-body">&ldquo;{citation.translation ?? citation.quote}&rdquo;</blockquote>}
        {source && (
          <p className="text-caption font-normal text-muted">
            <a href={source.url} className="text-ink underline underline-offset-2" rel="noopener noreferrer">
              {source.publisher}, {formatLongDate(source.publishedOn)}
            </a>
            {source.archivedUrl && (
              <>
                {", "}
                <a href={source.archivedUrl} className="text-ink underline underline-offset-2" rel="noopener noreferrer">
                  archived copy
                </a>
              </>
            )}
          </p>
        )}
        <p className="text-small">{cut.placement.split(". ")[0]}. The replay marks it as a reconstructed position.</p>
        <Link href={`/cases/${cableCase.slug}?t=${cut.atUtc.slice(0, 16)}Z`} className="-mx-2 mt-1 flex min-h-11 w-fit items-center gap-1 rounded-full px-2 text-label">
          See it in the replay
          <Icon name="chevronRight" />
        </Link>
      </div>
    </Plate>
  );
}
