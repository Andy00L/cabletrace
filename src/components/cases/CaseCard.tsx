import { WarmCaseLink } from "@/components/cases/WarmCaseLink";
import type { CableCase } from "@/lib/cases/case-file";
import { SKETCH_HEIGHT, SKETCH_WIDTH, type CaseSketch } from "@/lib/cases/case-sketch";
import { describeTrackEvidenceBriefly } from "@/lib/cases/case-view";
import type { SeabedLineKind } from "@/lib/seabed/seabed-data";

// Line widths in screen px, whatever size the sketch is drawn at (non-scaling strokes): it shows 112 px wide on a case
// row, smaller in the case switcher and across the stage when the 3D view fails. In sketch units (640 wide) the lines
// came out under half a pixel on a row.
const LINE_STYLES: Record<SeabedLineKind, { className: string; width: number }> = {
  power: { className: "stroke-cable", width: 1.4 },
  telecom: { className: "stroke-cable", width: 1 },
  pipeline: { className: "stroke-pipeline", width: 1.6 },
};
const TRACK_WIDTH = 1.6;
const DRAG_WIDTH = 2.4;
// Every data line sits on a white casing this much wider (docs/UI_DESIGN_SYSTEM.md, Data).
const CASING_EXTRA_WIDTH = 1.5;
// The cut marker in screen px: an alarm ring, a white disc and an alarm centre, drawn as round dots of these widths.
const CUT_MARKER_DOTS = [
  { className: "stroke-alarm", width: 9 },
  { className: "stroke-card", width: 5.4 },
  { className: "stroke-alarm", width: 2.6 },
];

/** Draws a path twice: a white casing under the data-colored line. */
function CasedPath({ path, className, width }: { path: string; className: string; width: number }) {
  return (
    <>
      <path d={path} fill="none" className="stroke-card" strokeOpacity={0.9} strokeWidth={width + CASING_EXTRA_WIDTH} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" className={className} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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
      {sketch.dragPath && <path d={sketch.dragPath} fill="none" className="stroke-alarm" strokeWidth={DRAG_WIDTH} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {/* A zero-length stroke with round caps is a dot of its width in screen px, at any size of the sketch. */}
      {sketch.cuts.map((cut) => (
        <g key={cut.label}>
          {CUT_MARKER_DOTS.map((dot) => (
            <path key={dot.width} d={`M${cut.x} ${cut.y}h0`} className={dot.className} strokeWidth={dot.width} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * One case as a row on the case list (grouped by region), whose whole surface opens its replay: a small sketch beside
 * the place, date, title and one line of facts, so a dozen cases fit one screen. The row is vellum on the list's slate
 * field, where a shadow does not read: on hover it steps down to parchment and nothing moves, and the case's seabed
 * starts loading (WarmCaseLink). Its focus ring is dusk, since the house ring's ink is lost on slate.
 */
export function CaseCard({ cableCase, sketch }: { cableCase: CableCase; sketch: CaseSketch | null }) {
  const cutsLabel = cableCase.cuts.map((cut) => cut.label).join(", ");
  const trackLabel = describeTrackEvidenceBriefly(cableCase);
  const map = <div className="size-full overflow-hidden rounded-inner bg-depth-40">{sketch && <CaseSketchMap sketch={sketch} vesselName={cableCase.vessel.name} />}</div>;
  return (
    <WarmCaseLink
      href={`/cases/${cableCase.slug}`}
      area={cableCase.seabedArea}
      className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3.5 rounded-row bg-card p-2 transition-colors duration-140 ease-standard hover:bg-page focus-visible:shadow-[0_0_0_2px_var(--color-slate),0_0_0_4px_var(--color-dusk)]!"
      testId={`case-card-${cableCase.slug}`}
    >
      <div className="aspect-video">{map}</div>
      <div className="flex min-w-0 flex-col gap-0.5 pr-2">
        <span className="truncate text-caption text-muted">{cableCase.subtitle}</span>
        <h3 className="truncate text-label">{cableCase.title}</h3>
        <span className="truncate text-caption font-normal text-muted">
          {cutsLabel}. {trackLabel}. <span className="tabular-nums">{cableCase.sources.length}</span> sources
        </span>
      </div>
    </WarmCaseLink>
  );
}
