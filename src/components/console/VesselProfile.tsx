"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useConsole } from "@/components/console/console-context";
import { useMomentSample } from "@/components/console/MomentNumbers";
import { buildVesselProfile, isInDragWindow, readVesselAnchor, type AnchorState, type ProfileLineRole, type ProfileShapeRole, type VesselAnchor } from "@/lib/console/vessel-profile";
import { progressToTimeMs } from "@/lib/replay/replay-scene";

// The drawing's height on board 23 (CSS px), its tallest: a stowed anchor needs no water column and draws shorter.
// Its width follows the card it sits in.
const PROFILE_HEIGHT_PX = 118;
// Until the card is measured (one frame), the rail's inner width: 360 px less 20 px of padding on each side.
const FALLBACK_WIDTH_PX = 320;
// The anchor glyph from board 23: a shank and a crown, 12 px wide, its shackle at the chain's end.
const ANCHOR_GLYPH_PATH = "M6 0 V8 M1 6 Q6 11 11 6";
const METRES_FORMAT = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

const SHAPE_CLASS: Record<ProfileShapeRole, string> = {
  hull: "fill-ink-hover",
  structure: "fill-ink-hover",
  cargo: "fill-faint",
  funnel: "fill-muted",
  window: "fill-page",
};
const LINE_CLASS: Record<ProfileLineRole, string> = { rig: "stroke-ink-hover", waterline: "stroke-muted" };

export const ANCHOR_STATE_LABELS: Record<AnchorState, string> = { stowed: "Anchor stowed", "let-go": "Anchor let go", dragging: "Anchor dragging" };

export function formatMetres(metres: number): string {
  return `${METRES_FORMAT.format(metres)} m`;
}

/**
 * The case ship's anchor at the replay moment, from the same state the 3D view and the charts read: the drag window
 * at the exact replay minute and the water depth of the chart sample under the cursor.
 */
export function useVesselAnchor(): VesselAnchor {
  const { input, clock } = useConsole();
  const sample = useMomentSample();
  const readIsAnchorDown = () => isInDragWindow(input.dragWindow, progressToTimeMs(input, clock.getSnapshot().progress));
  const isAnchorDown = useSyncExternalStore(clock.subscribe, readIsAnchorDown, readIsAnchorDown);
  const depthMetres = sample?.depthMetres ?? null;
  return useMemo(
    () => readVesselAnchor({ kind: input.vessel.kind, lengthMetres: input.vessel.lengthMetres, isAnchorDown, depthMetres }),
    [input.vessel.kind, input.vessel.lengthMetres, isAnchorDown, depthMetres],
  );
}

/** The width of an element as the browser lays it out, followed with a ResizeObserver. */
function useElementWidth(element: HTMLElement | null): number | null {
  const [widthPx, setWidthPx] = useState<number | null>(null);
  // Follows the layout, a browser system React does not own; disconnects when the element goes.
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidthPx(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return widthPx;
}

function describeProfile(name: string, anchor: VesselAnchor): string {
  const { reading, chain } = anchor;
  const chainOut = formatMetres(chain.nominalPaidOutMetres);
  switch (reading.state) {
    case "stowed":
      return `Side profile of ${name} to scale, the anchor stowed in the hawse`;
    case "let-go":
      return `Side profile of ${name} to scale, the anchor let go with ${chainOut} of chain out; ${reading.reason === "depth-unknown" ? "the seabed under the ship is not mapped" : "the water is deeper than the chain reaches"}`;
    case "dragging":
      return `Side profile of ${name} to scale: ${chainOut} of chain run from the hawse to the anchor on the seabed, ${formatMetres(reading.laybackMetres)} behind the hawse, in ${formatMetres(reading.depthMetres)} of water`;
    default: {
      const unhandledReading: never = reading;
      return unhandledReading;
    }
  }
}

/** Clamps a label's anchor point so a label of about `halfWidthPx` either side stays inside the drawing. */
function clampLabelX(centerX: number, halfWidthPx: number, widthPx: number): number {
  return Math.min(widthPx - halfWidthPx - 2, Math.max(halfWidthPx + 2, centerX));
}

/**
 * The case ship in side profile, to scale, with its anchor stowed, let go or dragging, and the chain paid out and
 * the layback drawn behind the bow (style board, board 23). The drawing fills its container's width.
 */
export function VesselProfile({ anchor }: { anchor: VesselAnchor }) {
  const { input } = useConsole();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const widthPx = useElementWidth(container) ?? FALLBACK_WIDTH_PX;
  const profile = useMemo(() => buildVesselProfile({ kind: input.vessel.kind, anchor, widthPx, heightPx: PROFILE_HEIGHT_PX }), [input.vessel.kind, anchor, widthPx]);
  const { reading, chain } = anchor;
  const isOnSeabed = reading.state === "dragging";
  const glyphClass = reading.state === "stowed" ? "stroke-card" : isOnSeabed ? "stroke-alarm" : "stroke-ink";
  return (
    <div ref={setContainer} className="w-full">
      <svg
        role="img"
        aria-label={describeProfile(input.vessel.name, anchor)}
        width={widthPx}
        height={profile.heightPx}
        viewBox={`0 0 ${widthPx} ${profile.heightPx}`}
        className="block overflow-visible text-micro font-normal tabular-nums"
        data-testid="vessel-profile"
        data-state={reading.state}
        data-chain-out-metres={reading.state === "stowed" ? 0 : Math.round(chain.nominalPaidOutMetres)}
        data-layback-metres={reading.state === "dragging" ? Math.round(reading.laybackMetres) : undefined}
      >
        <path d={`M0 ${profile.surfaceY.toFixed(1)}H${widthPx}`} className="stroke-faint" strokeWidth={1} strokeDasharray="3 3" />
        {profile.seabedY !== null && (
          <>
            <path d={`M0 ${(profile.seabedY + 3).toFixed(1)}H${widthPx}`} className="stroke-soft" strokeWidth={4} />
            <path d={`M0 ${profile.seabedY.toFixed(1)}H${widthPx}`} className="stroke-muted" strokeWidth={1.2} />
          </>
        )}
        {profile.shapes.map((shape, index) => (
          <path key={index} d={shape.d} className={SHAPE_CLASS[shape.role]} />
        ))}
        {profile.lines.map((line, index) => (
          <path key={index} d={line.d} fill="none" className={LINE_CLASS[line.role]} strokeWidth={1.2} strokeLinecap="round" />
        ))}
        {profile.chain && (
          <path d={profile.chain.d} fill="none" className={isOnSeabed ? "stroke-alarm" : "stroke-ink"} strokeWidth={1.6} strokeLinecap="round" strokeDasharray={reading.state === "let-go" ? "4 3" : undefined} />
        )}
        <path
          d={ANCHOR_GLYPH_PATH}
          transform={`translate(${(profile.anchorPoint.x - 6).toFixed(1)} ${(profile.anchorPoint.y - (isOnSeabed ? 6 : 2)).toFixed(1)})`}
          fill="none"
          className={glyphClass}
          strokeWidth={reading.state === "stowed" ? 1.4 : 1.8}
          strokeLinecap="round"
        />
        {reading.state === "dragging" && profile.chain && profile.seabedY !== null && (
          <>
            <text x={clampLabelX(profile.chain.labelPoint.x, 48, widthPx)} y={profile.chain.labelPoint.y} textAnchor="middle" dominantBaseline="auto" className="fill-muted">
              chain out {formatMetres(chain.nominalPaidOutMetres)}
            </text>
            <text
              x={profile.anchorPoint.x < widthPx / 2 ? Math.max(2, profile.anchorPoint.x - 6) : Math.min(widthPx - 2, profile.anchorPoint.x + 6)}
              y={profile.seabedY + 18}
              textAnchor={profile.anchorPoint.x < widthPx / 2 ? "start" : "end"}
              className="fill-muted"
            >
              anchor, {formatMetres(reading.laybackMetres)} behind the hawse
            </text>
            <path d={`M${widthPx - 5} ${(profile.surfaceY + 1).toFixed(1)}V${(profile.seabedY - 1).toFixed(1)}`} className="stroke-faint" strokeWidth={1} />
            <text x={widthPx - 9} y={(profile.surfaceY + profile.seabedY) / 2} textAnchor="end" dominantBaseline="central" className="fill-muted">
              {formatMetres(reading.depthMetres)}
            </text>
          </>
        )}
        {reading.state === "let-go" && profile.chain && (
          <text x={profile.chain.labelPoint.x} y={profile.chain.labelPoint.y} textAnchor="end" className="fill-muted">
            chain out {formatMetres(chain.nominalPaidOutMetres)}, {reading.reason === "depth-unknown" ? "seabed not mapped here" : "deeper than the chain"}
          </text>
        )}
      </svg>
    </div>
  );
}

/** The profile at the replay moment, for the vessel card on the ship. */
export function VesselProfileAtMoment() {
  const anchor = useVesselAnchor();
  return <VesselProfile anchor={anchor} />;
}
