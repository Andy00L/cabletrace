import Link from "next/link";
import type { CableCase } from "@/lib/cases/case-file";
import { formatUtcDate } from "@/lib/replay/format-utc";

// The landing ends on one quiet line, no block: what this is, the links, and the project's own links. The data and
// picture credits every page owes its sources live on /credits, which the line links to.
const REPOSITORY_URL = "https://github.com/Andy00L/cabletrace";

type FooterLink = { label: string; href: string; isExternal: boolean };

const FOOTER_LINKS: FooterLink[] = [
  { label: "Cases", href: "/cases", isExternal: false },
  { label: "Live", href: "/live", isExternal: false },
  { label: "Watchlist", href: "/watchlist", isExternal: false },
  { label: "Data and credits", href: "/credits", isExternal: false },
  { label: "Source on GitHub", href: REPOSITORY_URL, isExternal: true },
];

function FooterAnchor({ link }: { link: FooterLink }) {
  const className = "flex min-h-11 items-center text-small text-ink underline-offset-4 hover:underline";
  if (link.isExternal) {
    return (
      <a href={link.href} className={className} rel="noopener noreferrer">
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} prefetch={false} className={className}>
      {link.label}
    </Link>
  );
}

type LandingRecordInput = {
  /** Every case on file, newest incident first (src/data/cases). */
  cases: readonly CableCase[];
  /** Lines the recorder watches, or null when it could not be read. */
  cablesWatched: number | null;
  regionCount: number;
};

/**
 * The closing line's record under its headline: "10 cases on file, the newest on 30 Mar 2026. 1,204 cables and
 * pipelines watched in 8 regions." Each sentence is dropped when its data is missing; null when both are.
 */
export function describeLandingRecord({ cases, cablesWatched, regionCount }: LandingRecordInput): string | null {
  const sentences: string[] = [];
  const newestCase = cases[0];
  if (newestCase) {
    const caseCount = cases.length === 1 ? "1 case" : `${cases.length.toLocaleString("en-US")} cases`;
    const newestOn = formatUtcDate(Date.parse(newestCase.cuts[0].atUtc));
    sentences.push(newestOn === "" ? `${caseCount} on file.` : `${caseCount} on file, the newest on ${newestOn}.`);
  }
  if (cablesWatched !== null && cablesWatched > 0) {
    const regions = regionCount === 1 ? "1 region" : `${regionCount} regions`;
    sentences.push(`${cablesWatched.toLocaleString("en-US")} cables and pipelines watched in ${regions}.`);
  }
  return sentences.length === 0 ? null : sentences.join(" ");
}

export function LandingFooter({ contentClassName }: { contentClassName: string }) {
  return (
    <footer className={`${contentClassName} grid gap-2 pt-20 pb-6 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-8`} aria-label="Site">
      <p className="text-small text-muted">CableTrace, every cable cut replayed from its sources</p>
      <nav aria-label="Footer">
        <ul className="flex flex-wrap gap-x-6">
          {FOOTER_LINKS.map((link) => (
            <li key={link.label}>
              <FooterAnchor link={link} />
            </li>
          ))}
        </ul>
      </nav>
      <p className="flex items-center gap-6 text-small text-muted md:justify-end">
        <Link href="/api/health" prefetch={false} className="flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
          Health
        </Link>
        <span>2026</span>
      </p>
    </footer>
  );
}
