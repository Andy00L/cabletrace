import Link from "next/link";
import type { CableCase } from "@/lib/cases/case-file";
import { formatUtcDate } from "@/lib/replay/format-utc";

/**
 * One case as a list row (docs/UI_DESIGN_SYSTEM.md, List row): a sample of the cut line, the title and
 * subtitle, the date, a chevron. At rest the row shadow; on hover the shadow deepens and nothing moves.
 */
export function CaseRow({ cableCase }: { cableCase: CableCase }) {
  return (
    <Link
      href={`/cases/${cableCase.slug}`}
      className="flex items-center gap-3.5 rounded-row bg-card px-4.5 py-4 shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised"
      data-testid={`case-row-${cableCase.slug}`}
    >
      <svg width="32" height="20" viewBox="0 0 32 20" aria-hidden="true" className="flex-none">
        <path d="M2 14 C 6 14, 9 11, 12 10.5" stroke="var(--color-cable)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M18 9.5 C 22 8.5, 25 6, 30 6" stroke="var(--color-cable)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="15" cy="10" r="2.2" fill="var(--color-alarm)" />
      </svg>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label">{cableCase.title}</span>
        <span className="text-caption font-normal text-muted">{cableCase.subtitle}</span>
      </span>
      <span className="text-small whitespace-nowrap tabular-nums">{formatUtcDate(Date.parse(cableCase.window.startUtc))}</span>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="flex-none text-muted">
        <path d="M8 5 L13 10 L8 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
