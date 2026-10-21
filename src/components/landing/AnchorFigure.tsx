import "@/components/iso/iso.css";
import "@/components/landing/anchor-figure.css";
import { Line, Plate, Solid, Dots } from "@/components/iso/draw";
import { AnchorFigureLive, type RestingArt } from "@/components/landing/AnchorFigureLive";
import { alongTransform, buildRestingFrame, slideTransform } from "@/components/landing/anchor-figure-frame";
import { buildStaticArt } from "@/components/landing/anchor-figure-geometry";
import { buildPlumeStipple } from "@/components/landing/anchor-figure-plume";
import { DRAWN_SCALES, VIEW_HEIGHT, VIEW_WIDTH, buildFigureView } from "@/components/landing/anchor-figure-view";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSeries } from "@/lib/cases/load-case-series";
import { CABLE_SPACING_METRES, PAID_OUT_MIN_METRES, TIME_LAPSE, describeChainForSpeech, paidOutMaxMetres, readAnchorFigureFacts } from "@/lib/landing/anchor-figure-model";

// The cut whose minute the figure reads its depth and speed from: the C-Lion1 cut, the one the evidence note explains.
const FIGURE_CUT_LABEL = "C-Lion1";

/**
 * The front page's interactive centrepiece (Anatomy kit, src/components/iso): a cutaway block of the Gulf of Finland
 * under Eagle S, its chain paid out to the anchor that ploughs the seabed and parts a cable. The depth and speed are
 * the replay's own at the C-Lion1 cut and the chain is the detector's anchor model, so every number on the card is the
 * console's. Static art is built here once; AnchorFigureLive moves it. Renders nothing when the seabed files cannot
 * be read at build time (logged), rather than a figure with invented numbers.
 */
export async function AnchorFigure() {
  const series = await loadCaseSeries(toReplaySceneInput(EAGLE_S_2024));
  if (!series) return null;
  const read = readAnchorFigureFacts({ cableCase: EAGLE_S_2024, cutLabel: FIGURE_CUT_LABEL, series });
  if (!read.ok) {
    console.error(`[AnchorFigure] ${read.reason}`);
    return null;
  }
  const facts = read.value;
  const view = buildFigureView(facts);
  const { block, ship, scale, seabedTexture } = buildStaticArt(view);
  const resting = buildRestingFrame(facts, view);
  // The resting frame as plain strings: the browser draws it as it is and loads the motion only once it is seen.
  const restingArt: RestingArt = {
    chain: resting.chain,
    anchorParts: resting.anchor.parts,
    shackle: resting.anchor.shackle,
    furrow: resting.furrow,
    cables: resting.cableArts,
    stipple: buildPlumeStipple(view),
    slide: slideTransform(view, resting.moment.travelledMetres, seabedTexture.period),
    stippleTransform: alongTransform(view, resting.anchor.flukeTip[0]),
    speech: describeChainForSpeech(resting.reading),
    paidOutMetres: Math.round(resting.moment.paidOutMetres),
    paidOutRange: [PAID_OUT_MIN_METRES, paidOutMaxMetres(facts)],
  };
  const chainOut = Math.round(facts.chain.chainPerAnchorMetres);
  const label = `Illustration: a cutaway block of sea ${Math.round(facts.depthMetres)} m deep under the tanker ${facts.vesselName}. Its anchor chain hangs from the bow to the anchor, which ploughs a furrow in the seabed and parts a cable lying across it.`;

  // Element props each carry a key at their root (Anatomy references/react.md, the large-page key-warning trap).
  const back = (
    <g key="back">
      <path className="iso-halo" d={block.plinth.fill} />
      {block.feet.map((paths, index) => (
        <Solid key={index} paths={paths} tone="lo" />
      ))}
      <Solid paths={block.plinth} tone="lo" />
      <Dots points={block.plinthScrews} size={0.55} tone="mid" />
      <Solid paths={block.sediment} tone="mid" inner={<Line d={block.strata} tone="faint" />} />
    </g>
  );
  const texture = (
    <g key="texture">
      <Line d={seabedTexture.ripples} tone="faint" />
      {seabedTexture.stones.map((paths, index) => (
        <Solid key={index} paths={paths} tone="lo" />
      ))}
    </g>
  );
  const waterBack = (
    <g key="water-back">
      <Line d={block.waterBack} tone="faint" />
    </g>
  );
  const hullUnderwater = (
    <g key="hull-underwater">
      <Solid paths={ship.underwater} tone="mid" />
    </g>
  );
  const surface = (
    <g key="surface">
      <Line d={block.surfaceHatch} tone="faint" className="af-surface-hatch" />
      <Line d={block.surfaceEdges} tone="lo" />
    </g>
  );
  const shipAbove = (
    <g key="ship-above">
      <Solid paths={ship.topsides} tone="hi" inner={<Line d={ship.bootTop} tone="lo" />} />
      <Line d={ship.catwalk} tone="lo" />
      <Solid paths={ship.manifold} tone="mid" />
      <Solid paths={ship.crane.post} tone="mid" />
      <Line d={ship.crane.jib} tone="mid" />
      <Solid paths={ship.forecastle} tone="hi" />
      {ship.windlass.map((paths, index) => (
        <Solid key={`windlass-${index}`} paths={paths} tone="mid" />
      ))}
      {ship.bitts.map((paths, index) => (
        <Solid key={`bitt-${index}`} paths={paths} tone="mid" />
      ))}
      <Line d={ship.deckChain} tone="lit" />
      <Line d={ship.hawseRing} tone="hi" />
      {ship.house.map((paths, index) => (
        <Solid key={`tier-${index}`} paths={paths} tone="hi" />
      ))}
      <Solid paths={ship.lifeboat} tone="mid" />
      <Solid paths={ship.bridge} tone="hi" inner={<Line d={ship.windows} tone="mid" />} />
      <Solid paths={ship.funnel} tone="hi" inner={<Line d={ship.funnelBand} tone="mid" />} />
      <Solid paths={ship.mast} tone="mid" />
    </g>
  );
  const waterFront = (
    <g key="water-front">
      <Line d={block.waterFront} tone="faint" />
    </g>
  );
  const depthScale = (
    <g key="scale">
      <Solid paths={scale.foot} tone="mid" />
      <Solid paths={scale.post} tone="mid" inner={<g><Line d={scale.ticks.minor} tone="lo" /><Line d={scale.ticks.major} tone="mid" /></g>} />
    </g>
  );

  return (
    <div className="iso af" data-theme="light">
      <Plate
        fig="Fig 1"
        title="A dragged anchor"
        hint="Drag sideways, or use the arrow keys, to pay out or haul in chain"
        readout={resting.readout}
        caption={`Illustrated, from the case file and the replay's own numbers: ${facts.vesselName}, a ${facts.lengthMetres} m tanker, dragging at ${facts.speedKnots.toFixed(1)} knots in ${Math.round(facts.depthMetres)} m of water, the speed and depth the replay gives at the ${facts.cutLabel} cut. The chain is the detector's anchor model, ${chainOut} m of ${facts.chain.chainDiameterMm} mm chain per anchor hung as a catenary; with less chain out than the water is deep, the anchor hangs clear and a cable passes under it. Length and depth share one scale; the anchor is drawn ${DRAWN_SCALES.anchor} times its size, the chain's links ${DRAWN_SCALES.chainLink} times, and the cable thicker than life. Time runs ${TIME_LAPSE} times faster, and a cable comes every ${CABLE_SPACING_METRES} m to keep the loop short; in the case, five cables were broken along a drag trace of 90 to 100 km.`}
      >
        <AnchorFigureLive
          facts={facts}
          label={label}
          resting={restingArt}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          fade={{ from: block.fadeFrom, to: block.fadeTo, width: VIEW_WIDTH, height: VIEW_HEIGHT }}
          back={back}
          seabedTexture={texture}
          seabedPeriod={seabedTexture.period}
          seabedClip={block.seabedClip}
          waterClip={block.waterClip}
          waterBack={waterBack}
          hullUnderwater={hullUnderwater}
          surface={surface}
          shipAbove={shipAbove}
          waterFront={waterFront}
          scale={depthScale}
        />
      </Plate>
    </div>
  );
}
