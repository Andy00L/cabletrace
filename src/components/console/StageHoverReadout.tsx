"use client";

import { useEffect, useState } from "react";
import { useConsole } from "@/components/console/console-context";
import { describeGroundReadout, type GroundReadoutLine } from "@/lib/console/ground-readout";

// The hover readout (ui-console-2, 3.4): with a mouse resting on the sea, a small card by the pointer says how deep it
// is there, how far the nearest cable is and when the ship passed nearest. Mouse only: a touch is a camera move.
const POINTER_OFFSET_PX = 16;
// Room the card keeps from the stage's edges, and its width (CSS px), so it flips side before it would clip.
const EDGE_ROOM_PX = 12;
const CARD_WIDTH_PX = 288;
const CARD_HEIGHT_PX = 84;

type HoverState = { left: number; top: number; lines: GroundReadoutLine[] };

export function StageHoverReadout({ stageElement }: { stageElement: HTMLElement | null }) {
  const { directorPort, input } = useConsole();
  const [hover, setHover] = useState<HoverState | null>(null);

  // Follows the mouse over the stage, at most once a frame: pointer events and animation frames, which React does not own.
  useEffect(() => {
    if (!stageElement || !directorPort) return;
    let frameHandle: number | null = null;
    let latest: PointerEvent | null = null;
    const isOnPicture = (target: EventTarget | null) => target instanceof Element && target.closest('[data-testid="seabed-view"]') !== null && target.closest("button, a, [role='dialog'], [data-label-blocker]") === null;
    const readHover = () => {
      frameHandle = null;
      const event = latest;
      if (!event) return;
      const readout = isOnPicture(event.target) ? directorPort.readGroundAt(event.clientX, event.clientY) : null;
      if (!readout) {
        setHover(null);
        return;
      }
      const stageRect = stageElement.getBoundingClientRect();
      const pointerX = event.clientX - stageRect.left;
      const pointerY = event.clientY - stageRect.top;
      const fitsRight = pointerX + POINTER_OFFSET_PX + CARD_WIDTH_PX + EDGE_ROOM_PX <= stageRect.width;
      const fitsBelow = pointerY + POINTER_OFFSET_PX + CARD_HEIGHT_PX + EDGE_ROOM_PX <= stageRect.height;
      setHover({
        left: fitsRight ? pointerX + POINTER_OFFSET_PX : Math.max(EDGE_ROOM_PX, pointerX - POINTER_OFFSET_PX - CARD_WIDTH_PX),
        top: fitsBelow ? pointerY + POINTER_OFFSET_PX : Math.max(EDGE_ROOM_PX, pointerY - POINTER_OFFSET_PX - CARD_HEIGHT_PX),
        lines: describeGroundReadout(readout, input.cuts),
      });
    };
    const handlePointerMove = (event: PointerEvent) => {
      // A drag is a camera move, and a finger has no hover.
      if (event.pointerType !== "mouse" || event.buttons !== 0) {
        latest = null;
        setHover(null);
        return;
      }
      latest = event;
      frameHandle ??= requestAnimationFrame(readHover);
    };
    const handlePointerLeave = () => {
      latest = null;
      setHover(null);
    };
    stageElement.addEventListener("pointermove", handlePointerMove);
    stageElement.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      stageElement.removeEventListener("pointermove", handlePointerMove);
      stageElement.removeEventListener("pointerleave", handlePointerLeave);
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    };
  }, [stageElement, directorPort, input.cuts]);

  if (!hover) return null;
  return (
    <div
      className="pointer-events-none absolute z-(--layer-stage-controls) flex flex-col gap-0.5 rounded-field bg-card px-3 py-2.5 shadow-row"
      style={{ left: hover.left, top: hover.top, maxWidth: CARD_WIDTH_PX }}
      data-testid="stage-hover-readout"
    >
      {hover.lines.map((line) => (
        <p key={line.id} className={line.id === "depth" ? "text-label tabular-nums" : "text-caption font-normal text-muted tabular-nums"} data-testid={`stage-hover-${line.id}`}>
          {line.text}
        </p>
      ))}
    </div>
  );
}
