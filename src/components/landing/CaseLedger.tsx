import Link from "next/link";
import { AsciiPicture } from "@/components/ascii/AsciiPicture";
import { Icon } from "@/components/icons/Icon";
import { readRiseOrderStyle } from "@/components/landing/rise-order";
import { DiscoverButton } from "@/components/ui/DiscoverButton";
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

// The night painting the band's glyphs are drawn from, at its smallest width (src/lib/landing/archive-art.ts).
const NIGHT_SOURCE = "/landing/archive/albany-at-night-1200.webp";

/**
 * Every case on file as one band each, in two alternating tones on a slate field: the first cut's date, the ship and where, the lines
 * it cut, and how many sources the replay quotes. A band opens that case's replay.
 */
export function CaseLedger({ cases, contentClassName }: CaseLedgerProps) {
  const sourceCount = cases.reduce((total, cableCase) => total + cableCase.sources.length, 0);
  return (
    // A slate band the width of the page, the night painting behind it in 0s and 1s (the ASCII layer: the record as
    // data, its digits flipping slowly), the cases on vellum.
    <section aria-labelledby="cases-title" className="relative isolate overflow-hidden bg-slate py-20 text-page md:py-28">
      <AsciiPicture src={NIGHT_SOURCE} region={[0, 0.05, 1, 0.95]} style="binary" cellPx={8} background="slate" tone="slate" toneShare={0.5} isShimmering className="absolute inset-0 -z-10 size-full" />
      <div className={`${contentClassName} flex flex-col gap-14`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 id="cases-title" className="max-w-[760px] text-title sm:text-display" data-rise="ready">
            <span className="block text-mist">{cases.length} cases on file.</span>
            <span className="block">{sourceCount} sources behind them.</span>
          </h2>
          <span data-rise="ready" style={readRiseOrderStyle(1)}>
            <DiscoverButton href="/cases" label="See every case" tone="dusk" />
          </span>
        </div>
        <ol className="flex flex-col gap-1" data-testid="landing-cases">
          {cases.map((cableCase, index) => {
            const firstCutMs = Date.parse(cableCase.cuts[0].atUtc);
            return (
              <li key={cableCase.slug} data-rise="ready" style={readRiseOrderStyle(Math.min(index, 6))}>
                <Link
                  href={`/cases/${cableCase.slug}`}
                  className={`group grid gap-x-6 gap-y-1 rounded-field px-5 py-4 text-ink transition-colors duration-140 ease-standard hover:bg-dusk lg:min-h-[76px] lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,260px)_120px] lg:items-center ${index % 2 === 0 ? "bg-card" : "bg-soft"}`}
                  data-testid={`case-card-${cableCase.slug}`}
                >
                  <span className="text-lead tabular-nums">{formatUtcDate(firstCutMs)}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-card-title">{cableCase.title}</span>
                    <span className="text-small text-muted group-hover:text-ink">{cableCase.subtitle}</span>
                  </span>
                  <span className="text-small">{describeCutLines(cableCase)}</span>
                  <span className="flex items-center gap-1 text-small text-muted group-hover:text-ink lg:justify-end">
                    {cableCase.sources.length} sources
                    <Icon name="chevronRight" className="text-ink" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
