// What is on file and what is being recorded, each figure counted from the data and saying where it comes from
// (board 13, "the proof, in numbers"). No cards: numbers printed on the paper between hairlines.

/** `source` links where the figure is counted, only when that page is public (src/proxy.ts, isPublicRoute). */
export type ProofFigure = { value: string; label: string; detail: string; source?: { href: string; label: string } };

export function ProofNumbers({ figures }: { figures: ProofFigure[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-8 border-y border-ink/15 py-8 lg:grid-cols-4 lg:divide-x lg:divide-ink/15 lg:gap-0" data-testid="landing-numbers">
      {figures.map((figure) => (
        <div key={figure.label} className="flex flex-col gap-1 lg:px-6 lg:first:pl-0">
          <dt className="order-2 text-label">{figure.label}</dt>
          <dd className="order-1 text-display tabular-nums">{figure.value}</dd>
          <dd className="order-3 text-caption font-normal text-muted">
            {figure.detail}
            {figure.source && (
              <>
                {". "}
                <a href={figure.source.href} className="text-muted underline decoration-ink/25 underline-offset-2 hover:text-ink">
                  {figure.source.label}
                </a>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
