"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConsole } from "@/components/console/console-context";
import { Icon, type IconName } from "@/components/icons/Icon";
import { describeAnchorReadouts } from "@/lib/console/anchor-cam-readout";
import { progressToTimeMs } from "@/lib/replay/replay-scene";
import type { CameraDriver } from "@/lib/seabed/scene/director/camera-driver";
import type { DirectorViewerPort } from "@/lib/seabed/scene/director/viewer-port";

// The anchor cam window (board 22): a second picture of the scene from behind the anchor, top right of the stage, with
// the anchor's figures in its frame. It swaps with the main view and grows. On a phone it starts folded to a pill, so
// nothing is drawn for it until it is opened. Sizes in CSS px; the picture keeps board 22's 16:10.
export const ANCHOR_CAM_WIDTH_PX = 360;
const PICTURE_ASPECT = 16 / 10;
const EXPANDED_WIDTH_PX = 640;
/** The window's whole height at rest (picture plus the figures row), so the rail can start under it. */
export const ANCHOR_CAM_HEIGHT_PX = Math.round(ANCHOR_CAM_WIDTH_PX / PICTURE_ASPECT) + 68;
const MS_PER_MINUTE = 60_000;

type AnchorCamWindowProps = {
  driver: CameraDriver;
  port: DirectorViewerPort;
  /** `phone`: folded to a pill until pressed, then as wide as the stage. */
  presentation: "desktop" | "phone";
};

function WindowButton({ icon, label, isPressed, onClick, testId }: { icon: IconName; label: string; isPressed: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={isPressed}
      className="grid size-8 place-items-center rounded-full bg-card/92 text-ink transition-colors duration-140 ease-standard hover:bg-card active:scale-[0.97]"
      data-testid={testId}
      data-state={isPressed ? "on" : "off"}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function AnchorCamWindow({ driver, port, presentation }: AnchorCamWindowProps) {
  const { input, clock, shipCamera, setShipCamera, view, isDirectorOn } = useConsole();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFolded, setIsFolded] = useState(presentation === "phone");
  const pictureRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isSwapped = !isDirectorOn && view === "vessel" && shipCamera === "anchor";
  const isOpen = !isFolded;
  // The anchor's figures change once a replay minute: the window re-renders then, not every frame.
  const readMinute = () => Math.floor(progressToTimeMs(input, clock.getSnapshot().progress) / MS_PER_MINUTE);
  const minute = useSyncExternalStore(clock.subscribe, readMinute, readMinute);
  const readouts = useMemo(() => {
    const facts = port.readAnchorFacts(minute * MS_PER_MINUTE);
    return facts ? describeAnchorReadouts(facts, input.cuts) : null;
  }, [port, minute, input.cuts]);

  // Hands the picture's canvas and size to the viewer while the window is open (a render pass per drawn frame), and
  // takes it back when the window folds or goes: syncs with the 3D view and with the element's size, which React does
  // not own.
  useEffect(() => {
    const picture = pictureRef.current;
    const canvas = canvasRef.current;
    if (!isOpen || !picture || !canvas) return;
    // A window with no size (hidden, or the screenshot harness's overlays off) draws nothing.
    const register = () => driver.setAnchorWindow(picture.clientWidth > 0 && picture.clientHeight > 0 ? { canvas, widthPx: picture.clientWidth, heightPx: picture.clientHeight } : null);
    register();
    const resizeObserver = new ResizeObserver(register);
    resizeObserver.observe(picture);
    return () => {
      resizeObserver.disconnect();
      driver.setAnchorWindow(null);
    };
  }, [driver, isOpen]);

  if (isFolded) {
    return (
      <button
        type="button"
        onClick={() => setIsFolded(false)}
        className="absolute top-28 right-4 z-(--layer-panel) flex h-10 items-center gap-2 rounded-full bg-card px-3.5 text-label text-ink shadow-row transition-shadow duration-140 ease-standard hover:shadow-raised active:scale-[0.97]"
        data-testid="anchor-cam-open"
        data-label-blocker="true"
      >
        <span aria-hidden="true" className="size-[7px] rounded-full bg-alarm" />
        Anchor cam
      </button>
    );
  }

  const width = presentation === "phone" ? undefined : isExpanded ? EXPANDED_WIDTH_PX : ANCHOR_CAM_WIDTH_PX;
  return (
    <section
      aria-label="Anchor cam"
      className={`absolute top-4 right-4 z-(--layer-panel) overflow-hidden rounded-card bg-ink shadow-card ${presentation === "phone" ? "top-28 left-4" : ""}`}
      style={{ width }}
      data-testid="anchor-cam"
      data-state={isSwapped ? "swapped" : "anchor"}
      data-size={isExpanded ? "expanded" : "rest"}
      data-label-blocker="true"
    >
      <div ref={pictureRef} className="relative w-full" style={{ aspectRatio: PICTURE_ASPECT }}>
        <canvas ref={canvasRef} className="block size-full" role="img" aria-label={isSwapped ? "The ship, its chain and the anchor, seen from above its quarter" : "The seabed under the ship's anchor, seen from behind it, illustrated"} />
        <p className="absolute top-3 left-3 flex h-7 items-center gap-1.5 rounded-full bg-card/92 px-2.5 text-caption text-ink">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-alarm" />
          {isSwapped ? "The ship" : "Anchor cam"}
          <span className="font-normal text-muted">illustrated</span>
        </p>
        <div className="absolute top-3 right-3 flex gap-1.5">
          {setShipCamera && (
            <WindowButton icon="swap" label="Swap with the main view" isPressed={isSwapped} onClick={() => setShipCamera(isSwapped ? "follow" : "anchor")} testId="anchor-cam-swap" />
          )}
          {presentation === "phone" ? (
            <WindowButton icon="collapse" label="Fold the anchor cam" isPressed={false} onClick={() => setIsFolded(true)} testId="anchor-cam-fold" />
          ) : (
            <WindowButton icon={isExpanded ? "collapse" : "expand"} label={isExpanded ? "Shrink the anchor cam" : "Expand the anchor cam"} isPressed={isExpanded} onClick={() => setIsExpanded((wasExpanded) => !wasExpanded)} testId="anchor-cam-expand" />
          )}
        </div>
      </div>
      {/* The cable's name is the one long label: its column takes the room the three short figures leave. */}
      <dl className={`grid gap-x-4 gap-y-2 bg-card px-4 pt-3 pb-3.5 ${presentation === "phone" ? "grid-cols-2" : "grid-cols-[auto_auto_minmax(0,1fr)_auto]"}`}>
        {(readouts ?? []).map((readout) => (
          <div key={readout.id} className="flex min-w-0 flex-col" data-testid={`anchor-cam-${readout.id}`}>
            <dt className="truncate text-micro font-normal text-muted" title={readout.label}>
              {readout.label}
            </dt>
            <dd className="text-card-title font-semibold tabular-nums">
              {readout.value}
              <span className="ml-0.5 text-micro text-muted">{readout.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
