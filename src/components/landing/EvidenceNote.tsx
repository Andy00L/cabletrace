import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import type { CableCase, CaseCut } from "@/lib/cases/case-file";

function formatLongDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * What "every position tied to its source" means, on one cut, set into the water beside the anchor (no card): the
 * operator's own words, where they were published, and how the replay turned them into a point. All from the case file.
 */
export function EvidenceNote({ cableCase, cut }: { cableCase: CableCase; cut: CaseCut }) {
  const citation = cut.citations[0];
  const source = citation ? cableCase.sources.find((candidate) => candidate.id === citation.sourceId) : undefined;
  return (
    <div className="paper-halo flex flex-col gap-2" data-testid="landing-evidence">
      <p className="flex items-center gap-2 border-b border-ink/20 pb-2 text-caption text-muted">
        <span className="relative flex size-3 flex-none items-center justify-center rounded-full border-2 border-alarm" aria-hidden="true">
          <span className="size-1 rounded-full bg-alarm" />
        </span>
        {cut.label} cut, {formatLongDate(cut.atUtc)}, {cut.atUtc.slice(11, 16)} UTC
      </p>
      <h2 className="pt-1 text-heading">How a position is placed</h2>
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
      <Link href={`/cases/${cableCase.slug}?t=${cut.atUtc.slice(0, 16)}Z`} className="-mx-2 flex min-h-11 w-fit items-center gap-1 rounded-full px-2 text-label hover:bg-ink/5">
        See it in the replay
        <Icon name="chevronRight" />
      </Link>
    </div>
  );
}
