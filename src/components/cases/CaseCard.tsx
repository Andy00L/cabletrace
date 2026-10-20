import Link from "next/link";
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
 * One case as a row on the case list (grouped by region), whose whole surface opens its replay: a small sketch beside
 * the place, date, title and one line of facts, so a dozen cases fit one screen. On hover the shadow deepens and
 * nothing moves.
 */
export function CaseCard({ cableCase, sketch }: { cableCase: CableCase; sketch: CaseSketch | null }) {
  const cutsLabel = cableCase.cuts.map((cut) => cut.label).join(", ");
  const trackLabel = describeTrackEvidenceBriefly(cableCase);
  const map = <div className="size-full overflow-hidden rounded-inner bg-depth-40">{sketch && <CaseSketchMap sketch={sketch} vesselName={cableCase.vessel.name} />}</div>;
  return (
    <Link
      href={`/cases/${cableCase.slug}`}
      className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3.5 rounded-row bg-card p-2 shadow-card transition-shadow duration-140 ease-standard hover:shadow-raised"
      data-testid={`case-card-${cableCase.slug}`}
    >
      <div className="aspect-video">{map}</div>
      <div className="flex min-w-0 flex-col gap-0.5 pr-2">
        <span className="truncate text-caption text-muted">{cableCase.subtitle}</span>
        <h3 className="truncate text-label">{cableCase.title}</h3>
        <span className="truncate text-caption font-normal text-muted">
          {cutsLabel}. {trackLabel}. <span className="tabular-nums">{cableCase.sources.length}</span> sources
        </span>
      </div>
    </Link>
  );
}
