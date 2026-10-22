import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { readRiseOrderStyle } from "@/components/landing/rise-order";
import type { CableCase } from "@/lib/cases/case-file";
import { formatUtcDate } from "@/lib/replay/format-utc";

type CaseLedgerProps = {
  /** Every case on file, newest incident first (src/data/cases). */
  cases: readonly CableCase[];
  contentClassName: string;
};

/** "C-Lion1 and Estlink 2": the lines a case's cuts name, in order, each once. */
function describeCutLines(cableCase: CableCase): string {
  const labels = [...new Set(cableCase.cuts.map((cut) => cut.label))];
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Every case on file as one band each, in two alternating tones: the first cut's date, the ship and where, the lines
 * it cut, and how many sources the replay quotes. A band opens that case's replay.
 */
export function CaseLedger({ cases, contentClassName }: CaseLedgerProps) {
  const sourceCount = cases.reduce((total, cableCase) => total + cableCase.sources.length, 0);
  return (
    <section aria-labelledby="cases-title" className={`${contentClassName} flex flex-col gap-14`}>
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <h2 id="cases-title" className="max-w-[760px] text-title sm:text-display" data-rise="ready">
          <span className="block text-muted">{cases.length} cases on file.</span>
          <span className="block">{sourceCount} sources behind them.</span>
        </h2>
        <Link href="/cases" className="flex h-12 w-fit flex-none items-center gap-1 rounded-full bg-ink pr-4 pl-6 text-label text-card transition-colors duration-140 ease-standard hover:bg-ink-hover active:scale-[0.98]" data-rise="ready" style={readRiseOrderStyle(1)}>
          See every case
          <Icon name="chevronRight" />
        </Link>
      </div>
      <ol className="flex flex-col gap-1" data-testid="landing-cases">
        {cases.map((cableCase, index) => {
          const firstCutMs = Date.parse(cableCase.cuts[0].atUtc);
          return (
            <li key={cableCase.slug} data-rise="ready" style={readRiseOrderStyle(Math.min(index, 6))}>
              <Link
                href={`/cases/${cableCase.slug}`}
                className={`group grid gap-x-6 gap-y-1 rounded-field px-5 py-4 transition-colors duration-140 ease-standard hover:bg-ink hover:text-card lg:min-h-[76px] lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,260px)_120px] lg:items-center ${index % 2 === 0 ? "bg-card" : "bg-soft"}`}
                data-testid={`case-card-${cableCase.slug}`}
              >
                <span className="text-lead tabular-nums">{formatUtcDate(firstCutMs)}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-card-title">{cableCase.title}</span>
                  <span className="text-small text-muted group-hover:text-card/75">{cableCase.subtitle}</span>
                </span>
                <span className="text-small group-hover:text-card">{describeCutLines(cableCase)}</span>
                <span className="flex items-center gap-1 text-small text-muted group-hover:text-card/75 lg:justify-end">
                  {cableCase.sources.length} sources
                  <Icon name="chevronRight" className="text-ink group-hover:text-card" />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
