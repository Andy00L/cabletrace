"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { DiagnosticsReadout } from "@/components/diagnostics/DiagnosticsReadout";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { ESTLINK_2_SECTIONS } from "@/lib/diagnostics/estlink-2-route";
import { MAPLIBRE_WORKER_PATH } from "@/lib/map/maplibre-worker";

type MapProbeState =
  | { kind: "loading" }
  | { kind: "rendered"; firstRenderMs: number }
  | { kind: "failed"; reason: string };

// The Estlink 2 crossing, Anttila (Finland) to Püssi (Estonia), in longitude, latitude.
const ESTLINK_2_BOUNDS: [[number, number], [number, number]] = [[25.45, 59.4], [27.0, 60.33]];
// Casing 3px wider than the 2.5px power cable line (docs/UI_DESIGN_SYSTEM.md, Data).
const CABLE_WIDTH_PX = 2.5;
const CASING_WIDTH_PX = 5.5;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A self-contained style: no tile server, only a sea fill and the cable, so the probe measures WebGL and nothing else.
function buildProbeStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      cable: {
        type: "geojson",
        attribution: "Cable route © OpenStreetMap contributors (ODbL)",
        data: {
          type: "Feature",
          properties: { name: "HVDC Estlink 2" },
          geometry: { type: "MultiLineString", coordinates: ESTLINK_2_SECTIONS },
        },
      },
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": WEBGL_COLORS.depth50 } },
      {
        id: "cable-casing",
        type: "line",
        source: "cable",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": WEBGL_COLORS.casing, "line-opacity": 0.9, "line-width": CASING_WIDTH_PX },
      },
      {
        id: "cable-line",
        type: "line",
        source: "cable",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": WEBGL_COLORS.cable, "line-width": CABLE_WIDTH_PX },
      },
    ],
  };
}

function describeMapState(probeState: MapProbeState): string {
  switch (probeState.kind) {
    case "loading":
      return "Drawing the map";
    case "rendered":
      return "Map rendered";
    case "failed":
      return "Map failed";
    default: {
      const unhandledState: never = probeState;
      return unhandledState;
    }
  }
}

/** Draws Estlink 2 on a MapLibre map and reports whether, and how fast, the first frame completed. */
export function MapProbe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [probeState, setProbeState] = useState<MapProbeState>({ kind: "loading" });

  // Syncs with MapLibre, a WebGL map React does not own: created on mount, removed on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isCancelled = false;
    let removeMap: (() => void) | null = null;
    const startedAt = performance.now();

    async function startMap(mapContainer: HTMLDivElement) {
      try {
        const maplibre = await import("maplibre-gl");
        if (isCancelled) return;
        maplibre.setWorkerUrl(MAPLIBRE_WORKER_PATH);
        const map = new maplibre.Map({
          container: mapContainer,
          style: buildProbeStyle(),
          bounds: ESTLINK_2_BOUNDS,
          fitBoundsOptions: { padding: 32 },
          attributionControl: { compact: false },
        });
        removeMap = () => map.remove();
        map.once("idle", () => {
          if (!isCancelled) setProbeState({ kind: "rendered", firstRenderMs: performance.now() - startedAt });
        });
        map.on("error", (event) => {
          console.error(`[MapProbe] ${describeError(event.error)}`);
          if (!isCancelled) setProbeState({ kind: "failed", reason: describeError(event.error) });
        });
      } catch (error) {
        console.error(`[MapProbe] ${describeError(error)}`);
        if (!isCancelled) setProbeState({ kind: "failed", reason: describeError(error) });
      }
    }

    void startMap(container);
    return () => {
      isCancelled = true;
      removeMap?.();
    };
  }, []);

  return (
    <section
      className="flex flex-col gap-5 rounded-card bg-card p-6 shadow-card sm:p-7"
      data-testid="map-probe"
      data-state={probeState.kind}
      aria-labelledby="map-probe-title"
    >
      <div className="flex flex-col gap-1">
        <h2 id="map-probe-title" className="text-card-title">Map</h2>
        <p className="text-small text-muted">MapLibre draws Estlink 2, the power cable between Finland and Estonia.</p>
      </div>
      <div ref={containerRef} className="h-80 overflow-hidden rounded-inner bg-soft" role="img" aria-label="Map of the Estlink 2 cable route" />
      <DiagnosticsReadout
        rows={[
          { label: "Status", value: describeMapState(probeState), testId: "map-status" },
          {
            label: "First full render",
            value: probeState.kind === "rendered" ? `${Math.round(probeState.firstRenderMs)} ms` : "Not measured",
            testId: "map-first-render",
          },
          ...(probeState.kind === "failed" ? [{ label: "Error", value: probeState.reason, testId: "map-error", isAlarm: true }] : []),
        ]}
      />
    </section>
  );
}
