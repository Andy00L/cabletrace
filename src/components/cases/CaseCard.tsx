import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import type { CableCase } from "@/lib/cases/case-file";
import { SKETCH_HEIGHT, SKETCH_WIDTH, type CaseSketch } from "@/lib/cases/case-sketch";
import { describeTrackEvidenceBriefly } from "@/lib/cases/case-view";
import type { SeabedLineKind } from "@/lib/seabed/seabed-data";

// Line widths in sketch units (the sketch is 640 wide, drawn about 540 px on a desktop card).
const LINE_STYLES: Record<SeabedLineKind, { className: string; width: number }> = {
  power: { className: "stroke-cable", width: 1.6 },
  telecom: { className: "stroke-cable", width: 1.2 },
  pipeline: { className: "stroke-pipeline", width: 1.8 },
};
const TRACK_WIDTH = 2;
const DRAG_WIDTH = 3;
// Every data line sits on a white casing this much wider (docs/UI_DESIGN_SYSTEM.md, Data).
const CASING_EXTRA_WIDTH = 2.5;

/** Draws a path twice: a white casing under the data-colored line. */
function CasedPath({ path, className, width }: { path: string; className: string; width: number }) {
  return (
    <>
      <path d={path} fill="none" className="stroke-card" strokeOpacity={0.9} strokeWidth={width + CASING_EXTRA_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" className={className} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** The top-down sketch: land, routes, the track with its drag stretch, and the cuts. */
export function CaseSketchMap({ sketch, vesselName }: { sketch: CaseSketch; vesselName: string }) {
  return (
    <svg viewBox={`0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Map of the ${vesselName} track and the cut cables`} className="block size-full">
      <path d={sketch.landPath} className="fill-land" />
      {sketch.lines.map((line, index) => (
        <CasedPath key={index} path={line.path} className={LINE_STYLES[line.kind].className} width={LINE_STYLES[line.kind].width} />
      ))}
      <CasedPath path={sketch.trackPath} className="stroke-ink" width={TRACK_WIDTH} />
      {sketch.dragPath && <path d={sketch.dragPath} fill="none" className="stroke-alarm" strokeWidth={DRAG_WIDTH} strokeLinecap="round" strokeLinejoin="round" />}
      {sketch.cuts.map((cut) => (
        <g key={cut.label}>
          <circle cx={cut.x} cy={cut.y} r={6} className="fill-card stroke-alarm" strokeWidth={2.2} />
          <circle cx={cut.x} cy={cut.y} r={2.2} className="fill-alarm" />
        </g>
      ))}
    </svg>
  );
}

/**
 * One case as a card whose whole surface opens its replay; on hover the shadow deepens and nothing moves.
 * `tile` (the case list, board 12b): the sketch over a short text block. `wide` (the home page, board 12a): the
 * sketch beside the place, date, title and the three facts that set cases apart; from 1,024 px it shares the height
 * of its column with the other wide cards.
 */
export function CaseCard({ cableCase, sketch, layout }: { cableCase: CableCase; sketch: CaseSketch | null; layout: "tile" | "wide" }) {
  const cutsLabel = cableCase.cuts.map((cut) => cut.label).join(", ");
  const trackLabel = describeTrackEvidenceBriefly(cableCase);
  const map = <div className="size-full overflow-hidden rounded-inner bg-depth-40">{sketch && <CaseSketchMap sketch={sketch} vesselName={cableCase.vessel.name} />}</div>;
  if (layout === "wide") {
    const facts = [
      { label: "Cuts shown", value: cutsLabel },
      { label: "Track", value: trackLabel },
      { label: "Sources", value: String(cableCase.sources.length) },
    ];
    return (
      <Link
        href={`/cases/${cableCase.slug}`}
        className="grid gap-2 rounded-card bg-card p-2 shadow-card transition-shadow duration-140 ease-standard hover:shadow-raised md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-5 lg:min-h-0 lg:flex-1"
        data-testid={`case-card-${cableCase.slug}`}
      >
        {/* Between 1,024 and 1,280 px the card's map box is nearly square, and filling it would crop a cut away. */}
        <div className="aspect-video md:aspect-auto md:min-h-0 lg:max-xl:aspect-video lg:max-xl:self-start">{map}</div>
        <div className="flex min-w-0 flex-col gap-1.5 px-3 pt-2 pb-3 md:py-4 md:pr-4 md:pl-0">
          <span className="text-caption text-muted">{cableCase.subtitle}</span>
          <h3 className="text-heading">{cableCase.title}</h3>
          <dl className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-muted">{fact.label}</dt>
                <dd className="tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <span className="mt-auto flex items-center gap-1 pt-3 text-label">
            Open the replay
            <Icon name="chevronRight" />
          </span>
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={`/cases/${cableCase.slug}`}
      className="flex flex-col rounded-card bg-card p-2 shadow-card transition-shadow duration-140 ease-standard hover:shadow-raised"
      data-testid={`case-card-${cableCase.slug}`}
    >
      <div className="aspect-video">{map}</div>
      <div className="flex flex-col gap-1 px-3 pt-3 pb-2.5">
        <span className="text-caption text-muted">{cableCase.subtitle}</span>
        <h2 className="text-label">{cableCase.title}</h2>
        <span className="text-caption font-normal text-muted">
          {cutsLabel}. {trackLabel}. <span className="tabular-nums">{cableCase.sources.length}</span> sources
        </span>
      </div>
    </Link>
  );
}
