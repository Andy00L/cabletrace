import "@/components/iso/iso.css";
import "@/components/landing/anchor-figure.css";
import { AnchorFigureLive } from "@/components/landing/AnchorFigureLive";
import { buildStageFrame } from "@/components/landing/anchor-figure-frame";
import { DRAWN_STAGE } from "@/components/landing/anchor-figure-svg";
import { DRAWN_SCALES, VIEW_HEIGHT, VIEW_WIDTH, buildFigureView } from "@/components/landing/anchor-figure-view";
import { CABLE_SPACING_METRES, describeChainForSpeech, type FigureStage } from "@/lib/landing/anchor-figure-model";
import { loadAnchorFigureFacts } from "@/lib/landing/load-anchor-figure-facts";

// Where the figure's drawing is served (src/app/figures/anchor-figure.svg/route.ts).
const FIGURE_SVG_PATH = "/figures/anchor-figure.svg";

/**
 * The front page's anchor figure (Anatomy kit, src/components/iso): a cutaway block of the Gulf of Finland under the
 * bow of Eagle S, its chain run out to a Spek anchor that ploughs the clay and parts a cable. The depth and speed are
 * the replay's own at the C-Lion1 cut and the chain is the detector's anchor model, so every number in its readout is
 * the console's. Renders nothing when the seabed files cannot be read at build time (logged), rather than a figure
 * with invented numbers.
 *
 * It fills its box: put it in a sized parent (the page's sticky square, 560 px on desktop, 46svh on a phone) and it
 * centres a square drawing in what is left under its label row and over its readout. It shows three stages,
 * "drop" (the anchor let go, hanging), "drag" (ploughing toward a cable) and "cut" (the cable parted), and the page
 * steps it through them by wrapping it in AnchorFigureStage (a client component):
 *
 *   import { AnchorFigure } from "@/components/landing/AnchorFigure";            // in a server file
 *   import { AnchorFigureStage } from "@/components/landing/AnchorFigureStage";  // in the client section
 *   <AnchorFigureStage stage={stage}>{figure}</AnchorFigureStage>
 *
 * `stage` here is only where it starts without a wrapper (default "drop"). The reader's own control stays inside it:
 * drag sideways or use the arrow keys to pay out or haul in chain. Its caption is AnchorFigureCaption, for the page to
 * place where it fits. The drawing itself comes from the figure's route when it nears the view, so the page's HTML
 * carries none of its paths.
 */
export async function AnchorFigure({ stage = DRAWN_STAGE }: { stage?: FigureStage } = {}) {
  const read = await loadAnchorFigureFacts();
  if (!read.ok) {
    console.error(`[AnchorFigure] ${read.reason}`);
    return null;
  }
  const facts = read.value;
  const view = buildFigureView(facts);
  const frame = buildStageFrame(facts, view, stage);
  const label = `Illustration: a cutaway block of sea ${Math.round(facts.depthMetres)} m deep under the bow of the tanker ${facts.vesselName}. Its anchor chain runs from the hawse down to a stockless anchor; let go, the anchor drags through the clay with one fluke dug in, ploughs a furrow and parts an armoured cable lying across it.`;

  return (
    <figure className="iso af" data-theme="light">
      <div className="af-head" aria-hidden="true">
        <span className="af-fig">Fig 1</span>
        <span className="af-title">A dragged anchor</span>
      </div>
      <AnchorFigureLive
        facts={facts}
        label={label}
        svgPath={FIGURE_SVG_PATH}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        speech={describeChainForSpeech(frame.reading)}
        paidOutMetres={Math.round(frame.moment.paidOutMetres)}
        paidOutRange={view.paidOutRange}
        initialStage={stage}
      />
      <div className="af-foot" aria-hidden="true">
        <p className="af-readout" data-readout="">
          {frame.readout}
        </p>
        <p className="af-hint">Drag sideways, or use the arrow keys, to pay out or haul in chain</p>
      </div>
    </figure>
  );
}

/**
 * The figure's caption: what is drawn true and what is illustrated, with the case's own numbers. A separate block so
 * the page can set it beside or under the figure.
 */
export async function AnchorFigureCaption({ className }: { className?: string }) {
  const read = await loadAnchorFigureFacts();
  if (!read.ok) return null;
  const facts = read.value;
  const view = buildFigureView(facts);
  const [leastPaidOut, mostPaidOut] = view.paidOutRange;
  const chainOut = Math.round(facts.chain.chainPerAnchorMetres);
  return (
    <p className={className}>
      Illustrated, from the case file and the replay&apos;s own numbers: {facts.vesselName}, a {facts.lengthMetres} m tanker, dragging at {facts.speedKnots.toFixed(1)} knots in {Math.round(facts.depthMetres)} m of water, the speed and depth the
      replay gives at the {facts.cutLabel} cut. The chain is the detector&apos;s anchor model hung as a catenary, {facts.chain.chainDiameterMm} mm stud link; the figure pays out {leastPaidOut} to {mostPaidOut} m of the {chainOut} m per anchor, which
      keeps the anchor in the block. Length and depth share one scale; the {Math.round(facts.chain.anchorMassKg / 100) / 10} t Spek anchor is drawn {DRAWN_SCALES.anchor} times its size, the chain&apos;s links {DRAWN_SCALES.chainLink} times, and the
      cable, a generic double-armoured telecom build, thicker than life. Between the three moments the drag is played fast, and a cable lies every {CABLE_SPACING_METRES} m; in the case, five cables were broken along a drag trace of 90 to
      100 km.
    </p>
  );
}
