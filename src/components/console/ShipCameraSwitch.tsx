"use client";

import { useConsole } from "@/components/console/console-context";
import { Icon } from "@/components/icons/Icon";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import type { ShipCamera } from "@/lib/seabed/scene/director/camera-driver";

const SHIP_CAMERA_OPTIONS: readonly SegmentOption<ShipCamera>[] = [
  { value: "follow", label: "Follow" },
  { value: "bridge", label: "Bridge view" },
  { value: "anchor", label: "Anchor cam" },
];
const FOLLOW_BUTTON_CLASS = "flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]";

/**
 * The vessel card's cameras (board 22): Follow, Bridge view and Anchor cam, each in the Vessel view; none is pressed
 * while the director or another view holds the camera. Until the 3D view draws, only Follow is offered.
 */
export function ShipCameraSwitch() {
  const { view, setView, isDirectorOn, shipCamera, setShipCamera } = useConsole();
  const isFollowing = view === "vessel" && !isDirectorOn;
  if (!setShipCamera) {
    return (
      <button type="button" onClick={() => setView(view === "vessel" ? "overview" : "vessel")} aria-pressed={view === "vessel"} className={`${FOLLOW_BUTTON_CLASS} self-start`} data-testid="vessel-card-follow">
        <Icon name="follow" />
        {view === "vessel" ? "Stop following" : "Follow"}
      </button>
    );
  }
  return <SegmentedControl label="Camera" options={SHIP_CAMERA_OPTIONS} value={isFollowing ? shipCamera : null} onChange={setShipCamera} testId="ship-camera-switch" />;
}
