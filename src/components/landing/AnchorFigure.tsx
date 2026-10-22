import "@/components/iso/iso.css";
import "@/components/landing/anchor-figure.css";
import { Plate } from "@/components/iso/draw";
import { AnchorFigureLive } from "@/components/landing/AnchorFigureLive";
import { buildRestingFrame } from "@/components/landing/anchor-figure-frame";
import { DRAWN_SCALES, VIEW_HEIGHT, VIEW_WIDTH, buildFigureView } from "@/components/landing/anchor-figure-view";
import { CABLE_SPACING_METRES, TIME_LAPSE, describeChainForSpeech } from "@/lib/landing/anchor-figure-model";
import { loadAnchorFigureFacts } from "@/lib/landing/load-anchor-figure-facts";

// Where the figure's drawing is served (src/app/figures/anchor-figure.svg/route.ts).
const FIGURE_SVG_PATH = "/figures/anchor-figure.svg";

/**
 * The front page's interactive centrepiece (Anatomy kit, src/components/iso): a cutaway block of the Gulf of Finland
 * under the bow of Eagle S, its chain paid out to a Spek anchor that ploughs the clay and parts a cable. The depth and
 * speed are the replay's own at the C-Lion1 cut and the chain is the detector's anchor model, so every number on the
 * card is the console's. This renders the card, its readout and caption; the drawing itself comes from the figure's
 * route when it nears the view (AnchorFigureLive), so the page's HTML carries none of its paths. Renders nothing when
 * the seabed files cannot be read at build time (logged), rather than a figure with invented numbers.
 */
export async function AnchorFigure() {
  const read = await loadAnchorFigureFacts();
  if (!read.ok) {
    console.error(`[AnchorFigure] ${read.reason}`);
    return null;
  }
  const facts = read.value;
  const view = buildFigureView(facts);
  const resting = buildRestingFrame(facts, view);
  const [leastPaidOut, mostPaidOut] = view.paidOutRange;
  const chainOut = Math.round(facts.chain.chainPerAnchorMetres);
  const label = `Illustration: a cutaway block of sea ${Math.round(facts.depthMetres)} m deep under the bow of the tanker ${facts.vesselName}. Its anchor chain runs from the hawse down to a stockless anchor dragging through the clay, one fluke dug in, ploughing a furrow and parting an armoured cable that lies across it.`;

  return (
    <div className="iso af" data-theme="light">
      <Plate
        fig="Fig 1"
        title="A dragged anchor"
        hint="Drag sideways, or use the arrow keys, to pay out or haul in chain"
        readout={resting.readout}
        caption={`Illustrated, from the case file and the replay's own numbers: ${facts.vesselName}, a ${facts.lengthMetres} m tanker, dragging at ${facts.speedKnots.toFixed(1)} knots in ${Math.round(facts.depthMetres)} m of water, the speed and depth the replay gives at the ${facts.cutLabel} cut. The chain is the detector's anchor model hung as a catenary, ${facts.chain.chainDiameterMm} mm stud link; the figure pays out ${leastPaidOut} to ${mostPaidOut} m of the ${chainOut} m per anchor, which keeps the anchor in the block. With less chain out than the water is deep, the anchor hangs clear and a cable passes under it. Length and depth share one scale; the ${Math.round(facts.chain.anchorMassKg / 100) / 10} t Spek anchor is drawn ${DRAWN_SCALES.anchor} times its size, the chain's links ${DRAWN_SCALES.chainLink} times, and the cable, a generic double-armoured telecom build, thicker than life. Time runs ${TIME_LAPSE} times faster, and a cable comes every ${CABLE_SPACING_METRES} m to keep the loop short; in the case, five cables were broken along a drag trace of 90 to 100 km.`}
      >
        <AnchorFigureLive
          facts={facts}
          label={label}
          svgPath={FIGURE_SVG_PATH}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          speech={describeChainForSpeech(resting.reading)}
          paidOutMetres={Math.round(resting.moment.paidOutMetres)}
          paidOutRange={view.paidOutRange}
        />
      </Plate>
    </div>
  );
}
